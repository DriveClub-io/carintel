#!/usr/bin/env python3
"""
Import GM brand manuals from VHR (vehiclehistory.com) CDN.

GM brands use a different URL pattern than Kia:
  {year}_{make}_{Model}_{year} {Make} {Model} Owner Manual.pdf

This fills gaps in our database where:
1. We're missing manuals entirely
2. We have mismatched year PDFs

Usage:
    python import_vhr_gm.py          # Dry run - show what would be imported
    python import_vhr_gm.py --run    # Actually import the manuals
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

VHR_BASE = "https://vhr.nyc3.cdn.digitaloceanspaces.com/owners-manual"

# Manuals to import from VHR (discovered via scan)
# Format: (year, make, model, vhr_model, action)
# action: 'add' for new, 'replace' for fixing mismatched
MANUALS_TO_IMPORT = [
    # Chevrolet
    (2015, "Chevrolet", "Camaro", "Camaro", "add"),
    (2016, "Chevrolet", "Colorado", "Colorado", "add"),
    (2017, "Chevrolet", "Traverse", "Traverse", "add"),
    (2017, "Chevrolet", "Corvette", "Corvette", "add"),
    (2017, "Chevrolet", "Sonic", "Sonic", "add"),
    (2019, "Chevrolet", "Sonic", "Sonic", "add"),
    (2020, "Chevrolet", "Sonic", "Sonic", "add"),
    (2017, "Chevrolet", "Equinox", "Equinox", "replace"),
    (2021, "Chevrolet", "Equinox", "Equinox", "replace"),
    (2023, "Chevrolet", "Malibu", "Malibu", "replace"),
    (2022, "Chevrolet", "Colorado", "Colorado", "replace"),
    (2021, "Chevrolet", "Traverse", "Traverse", "replace"),
    (2021, "Chevrolet", "Blazer", "Blazer", "replace"),
    (2023, "Chevrolet", "Corvette", "Corvette", "replace"),
    # GMC
    (2017, "GMC", "Canyon", "Canyon", "add"),
    (2018, "GMC", "Canyon", "Canyon", "add"),
    (2019, "GMC", "Canyon", "Canyon", "add"),
    (2020, "GMC", "Canyon", "Canyon", "add"),
    (2021, "GMC", "Canyon", "Canyon", "add"),
    (2022, "GMC", "Canyon", "Canyon", "add"),
    # Buick
    (2024, "Buick", "Enclave", "Enclave", "add"),
    (2024, "Buick", "Envision", "Envision", "add"),
    # Cadillac
    (2024, "Cadillac", "Xt6", "XT6", "replace"),
    (2022, "Cadillac", "Ct4", "CT4", "replace"),
]


def get_vhr_url(year: int, make: str, vhr_model: str) -> str:
    """Build VHR URL using GM pattern."""
    make_lower = make.lower()
    # Pattern: {year}_{make}_{Model}_{year} {Make} {Model} Owner Manual.pdf
    filename = f"{year}_{make_lower}_{vhr_model}_{year}%20{make}%20{vhr_model}%20Owner%20Manual.pdf"
    return f"{VHR_BASE}/{make_lower}/{filename}"


def get_pdf_info(url: str) -> dict:
    """Get PDF size via HEAD request."""
    try:
        resp = requests.head(url, timeout=10)
        if resp.status_code == 200:
            size = int(resp.headers.get('content-length', 0))
            return {'exists': True, 'size': size}
        return {'exists': False, 'status': resp.status_code}
    except Exception as e:
        return {'exists': False, 'error': str(e)}


def download_pdf(url: str, dest: Path) -> bool:
    """Download PDF to destination."""
    try:
        print(f"    Downloading from VHR...")
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


def import_manual(year: int, make: str, model: str, vhr_model: str, action: str, dry_run: bool = True) -> bool:
    """Import a single manual from VHR."""
    vhr_url = get_vhr_url(year, make, vhr_model)

    print(f"\n{'[DRY RUN] ' if dry_run else ''}{year} {make} {model} ({action})")
    print(f"  VHR URL: {vhr_url}")

    # Check if VHR has it
    info = get_pdf_info(vhr_url)
    if not info['exists']:
        print(f"  SKIP: VHR doesn't have this ({info})")
        return False

    size_mb = info['size'] / 1024 / 1024
    print(f"  VHR size: {size_mb:.1f} MB")

    if dry_run:
        print(f"  Would {'add new' if action == 'add' else 'replace existing'} record")
        return True

    # Download
    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = Path(tmpdir) / f"{year}-{make.lower()}-{model.lower()}.pdf"

        if not download_pdf(vhr_url, local_path):
            return False

        # Upload to storage
        storage_path = f"{make.lower()}/{model.lower()}/{year}-{make.lower()}-{model.lower()}.pdf"
        if not upload_to_storage(local_path, storage_path):
            return False

        # Get the new PDF URL (from our storage)
        new_pdf_url = get_public_url(storage_path)

        # Update database
        if action == 'add':
            # Insert new record
            record = {
                'year': year,
                'make': make,
                'model': model,
                'variant': None,
                'source_url': vhr_url,
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

        elif action == 'replace':
            # Update existing record (fixes mismatched year)
            try:
                # Find existing record
                existing = supabase.table('vehicle_manuals').select('id').eq(
                    'make', make
                ).eq('model', model).eq('year', year).execute()

                if not existing.data:
                    print(f"    No existing record found to replace!")
                    return False

                record_id = existing.data[0]['id']

                # Update with new PDF
                supabase.table('vehicle_manuals').update({
                    'pdf_url': new_pdf_url,
                    'pdf_size_bytes': info['size'],
                    'pdf_storage_path': storage_path,
                    'year_mismatch': False,
                    'pdf_year': year,
                    'content_status': 'pending',  # Re-extract with correct PDF
                }).eq('id', record_id).execute()

                # Delete old extracted content so it gets re-extracted
                supabase.table('manual_content').delete().eq('manual_id', record_id).execute()
                supabase.table('manual_sections').delete().eq('manual_id', record_id).execute()

                print(f"    Updated existing record (id={record_id})")
            except Exception as e:
                print(f"    DB update failed: {e}")
                return False

    return True


def main():
    dry_run = '--run' not in sys.argv

    print("=" * 70)
    print("VHR GM Brands Manual Importer")
    print("=" * 70)

    if dry_run:
        print("\nDRY RUN MODE - No changes will be made")
        print("Run with --run to actually import\n")
    else:
        print("\nLIVE MODE - Will download and import manuals\n")

    print(f"Manuals to process: {len(MANUALS_TO_IMPORT)}")
    print(f"  - New additions: {sum(1 for m in MANUALS_TO_IMPORT if m[4] == 'add')}")
    print(f"  - Replacements (fix mismatched): {sum(1 for m in MANUALS_TO_IMPORT if m[4] == 'replace')}")

    # Group by make
    by_make = {}
    for m in MANUALS_TO_IMPORT:
        by_make[m[1]] = by_make.get(m[1], 0) + 1
    print("\nBy make:")
    for make, count in sorted(by_make.items()):
        print(f"  {make}: {count}")

    success = 0
    failed = 0

    for year, make, model, vhr_model, action in MANUALS_TO_IMPORT:
        if import_manual(year, make, model, vhr_model, action, dry_run):
            success += 1
        else:
            failed += 1

        if not dry_run:
            time.sleep(1)  # Be nice to VHR servers

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"Success: {success}")
    print(f"Failed: {failed}")

    if dry_run:
        print("\nRun with --run to actually import these manuals")


if __name__ == "__main__":
    main()
