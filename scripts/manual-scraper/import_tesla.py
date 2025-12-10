#!/usr/bin/env python3
"""
Import Tesla manuals from StartMyCar.com.

Tesla blocks direct access to their owner's manual site, but StartMyCar
has mirrored PDFs we can use.

Usage:
    python import_tesla.py          # Dry run - show what would be imported
    python import_tesla.py --run    # Actually import the manuals
"""

import os
import sys
import time
import tempfile
import requests
from pathlib import Path
from supabase import create_client

# Load credentials
env_file = Path(__file__).parent / '.env'
env_content = env_file.read_text()
service_key = env_content.split('SUPABASE_SERVICE_KEY=')[1].split('\n')[0].strip()

SUPABASE_URL = 'https://jxpbnnmefwtazfvoxvge.supabase.co'
supabase = create_client(SUPABASE_URL, service_key)

# Tesla manuals from StartMyCar
# Format: (year, model, pdf_url)
# Note: Model X 2015-2020 share the same PDF, so we only import one representative
TESLA_MANUALS = [
    # Model 3
    (2024, "Model 3", "https://manuals.startmycar.com/published/Tesla-Model-3_2024_EN__5091ae03e8.pdf"),
    # Model S
    (2021, "Model S", "https://manuals.startmycar.com/published/Tesla-Model-S_2021_EN_GB_20160f7762.pdf"),
    (2015, "Model S", "https://manuals.startmycar.com/published/Tesla-Model-S_2015_EN-US_US_0b113e88aa.pdf"),
    # Model X - only unique PDFs
    (2021, "Model X", "https://manuals.startmycar.com/published/Tesla-Model-X_2021_EN-US_US_9afc4d5774.pdf"),
    (2017, "Model X", "https://manuals.startmycar.com/published/Tesla-Model-X_2015-2016-2017-etc_EN__adb14c89fc.pdf"),  # Covers 2015-2020
    # Model Y
    (2021, "Model Y", "https://manuals.startmycar.com/published/Tesla-Model-Y_2021_EN-US_US_03fe16fda7.pdf"),
    # Cybertruck
    (2025, "Cybertruck", "https://manuals.startmycar.com/published/Tesla-Cybertruck_2025_EN_US_f51d0631ab.pdf"),
    (2024, "Cybertruck", "https://manuals.startmycar.com/published/Tesla-Cybertruck_2024_EN__83294d89c2.pdf"),
]


def get_pdf_info(url: str) -> dict:
    """Get PDF size via HEAD request."""
    try:
        resp = requests.head(url, timeout=10, allow_redirects=True)
        if resp.status_code == 200:
            size = int(resp.headers.get('content-length', 0))
            return {'exists': True, 'size': size}
        return {'exists': False, 'status': resp.status_code}
    except Exception as e:
        return {'exists': False, 'error': str(e)}


def download_pdf(url: str, dest: Path) -> bool:
    """Download PDF to destination."""
    try:
        print(f"    Downloading...")
        resp = requests.get(url, timeout=300, stream=True)
        resp.raise_for_status()

        with open(dest, 'wb') as f:
            for chunk in resp.iter_content(chunk_size=8192):
                f.write(chunk)

        size_mb = dest.stat().st_size / 1024 / 1024
        print(f"    Downloaded: {size_mb:.1f} MB")
        return True
    except Exception as e:
        print(f"    Download failed: {e}")
        return False


def upload_to_storage(local_path: Path, storage_path: str) -> bool:
    """Upload PDF to Supabase Storage."""
    try:
        print(f"    Uploading to storage...")
        with open(local_path, 'rb') as f:
            file_data = f.read()

        result = supabase.storage.from_('vehicle_manuals').upload(
            storage_path,
            file_data,
            file_options={'content-type': 'application/pdf', 'upsert': 'true'}
        )
        print(f"    Uploaded to: {storage_path}")
        return True
    except Exception as e:
        print(f"    Upload failed: {e}")
        return False


def get_public_url(storage_path: str) -> str:
    """Get public URL for storage path."""
    return f"{SUPABASE_URL}/storage/v1/object/public/vehicle_manuals/{storage_path}"


def check_existing(year: int, model: str) -> dict:
    """Check if we already have this manual in the database."""
    try:
        result = supabase.table('vehicle_manuals').select('id, pdf_storage_path').eq(
            'make', 'Tesla'
        ).eq('model', model).eq('year', year).execute()

        if result.data:
            return {'exists': True, 'id': result.data[0]['id'], 'has_storage': bool(result.data[0].get('pdf_storage_path'))}
        return {'exists': False}
    except:
        return {'exists': False}


def import_manual(year: int, model: str, pdf_url: str, dry_run: bool = True) -> bool:
    """Import a single Tesla manual."""
    print(f"\n{'[DRY RUN] ' if dry_run else ''}{year} Tesla {model}")
    print(f"  Source: {pdf_url}")

    # Check if exists
    existing = check_existing(year, model)
    if existing['exists'] and existing.get('has_storage'):
        print(f"  SKIP: Already in database with storage")
        return True

    # Check PDF is accessible
    info = get_pdf_info(pdf_url)
    if not info['exists']:
        print(f"  SKIP: PDF not accessible ({info})")
        return False

    size_mb = info['size'] / 1024 / 1024
    print(f"  PDF size: {size_mb:.1f} MB")

    action = 'upload' if existing['exists'] else 'add'

    if dry_run:
        print(f"  Would {action} record")
        return True

    # Download
    with tempfile.TemporaryDirectory() as tmpdir:
        model_slug = model.lower().replace(' ', '-')
        local_path = Path(tmpdir) / f"{year}-tesla-{model_slug}.pdf"

        if not download_pdf(pdf_url, local_path):
            return False

        # Upload to storage
        storage_path = f"tesla/{model_slug}/{year}-tesla-{model_slug}.pdf"
        if not upload_to_storage(local_path, storage_path):
            return False

        # Get the new PDF URL (from our storage)
        new_pdf_url = get_public_url(storage_path)

        if action == 'add':
            # Insert new record
            record = {
                'year': year,
                'make': 'Tesla',
                'model': model,
                'variant': None,
                'source_url': pdf_url,
                'pdf_url': new_pdf_url,
                'pdf_size_bytes': info['size'],
                'pdf_storage_path': storage_path,
                'content_status': 'pending',
                'year_mismatch': False,
                'pdf_year': year,
            }

            try:
                supabase.table('vehicle_manuals').insert(record).execute()
                print(f"    Added to database")
            except Exception as e:
                print(f"    DB insert failed: {e}")
                return False
        else:
            # Update existing record
            try:
                supabase.table('vehicle_manuals').update({
                    'pdf_url': new_pdf_url,
                    'pdf_size_bytes': info['size'],
                    'pdf_storage_path': storage_path,
                }).eq('id', existing['id']).execute()
                print(f"    Updated existing record (id={existing['id']})")
            except Exception as e:
                print(f"    DB update failed: {e}")
                return False

    return True


def main():
    dry_run = '--run' not in sys.argv

    print("=" * 70)
    print("Tesla Manual Importer (from StartMyCar.com)")
    print("=" * 70)

    if dry_run:
        print("\nDRY RUN MODE - No changes will be made")
        print("Run with --run to actually import\n")
    else:
        print("\nLIVE MODE - Will download and import manuals\n")

    print(f"Manuals to process: {len(TESLA_MANUALS)}")

    # Group by model
    by_model = {}
    for year, model, url in TESLA_MANUALS:
        by_model[model] = by_model.get(model, 0) + 1
    print("\nBy model:")
    for model, count in sorted(by_model.items()):
        print(f"  {model}: {count}")

    success = 0
    failed = 0

    for year, model, pdf_url in TESLA_MANUALS:
        if import_manual(year, model, pdf_url, dry_run):
            success += 1
        else:
            failed += 1

        if not dry_run:
            time.sleep(1)

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"Success: {success}")
    print(f"Failed: {failed}")

    if dry_run:
        print("\nRun with --run to actually import these manuals")


if __name__ == "__main__":
    main()
