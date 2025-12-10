#!/usr/bin/env python3
"""
Fix mismatched year manuals using VHR (vehiclehistory.com) CDN.

This script finds manuals where the PDF year doesn't match the vehicle year
and replaces them with correct-year PDFs from VHR when available.

Usage:
    python fix_mismatched_vhr.py          # Dry run - show what would be fixed
    python fix_mismatched_vhr.py --run    # Actually fix the manuals
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

# URL encoding constants
STRAIGHT_APOS = "%27"      # Straight apostrophe '
CURLY_APOS = "%E2%80%99"   # Curly/smart apostrophe '

# Manuals confirmed to exist on VHR with correct years
# Format: (year, make, model, vhr_model_name, url_style)
# url_style: "stellantis" (Title case), "kia" (lowercase/UPPER), "maserati" (lower/Title),
#            "ford" (curly apostrophe + Printing suffix), "lincoln" (curly apostrophe + Printing suffix)
# Found via comprehensive scan on 2025-12-10
MANUALS_TO_FIX = [
    # Chrysler - pattern: {year}_Chrysler_{Model}_Owner's Manual.pdf (Title case, straight apostrophe)
    (2020, "Chrysler", "Voyager", "Voyager", "stellantis"),
    (2021, "Chrysler", "Voyager", "Voyager", "stellantis"),
    (2020, "Chrysler", "300", "300", "stellantis"),
    (2018, "Chrysler", "Pacifica", "Pacifica", "stellantis"),
    (2019, "Chrysler", "Pacifica", "Pacifica", "stellantis"),
    (2020, "Chrysler", "Pacifica", "Pacifica", "stellantis"),
    (2022, "Chrysler", "Pacifica", "Pacifica", "stellantis"),

    # Dodge - pattern: {year}_Dodge_{Model}_Owner's Manual.pdf (Title case, straight apostrophe)
    (2024, "Dodge", "Durango", "Durango", "stellantis"),

    # Ford - pattern: {year}_ford_{model}_Owner's Manual Printing 1 PDF.pdf (curly apostrophe)
    (2024, "Ford", "F-150", "f-150", "ford"),

    # Jeep - pattern: {year}_Jeep_{Model}_Owner's Manual.pdf (Title case, straight apostrophe)
    (2022, "Jeep", "Compass", "Compass", "stellantis"),
    (2024, "Jeep", "Gladiator", "Gladiator", "stellantis"),

    # Kia - pattern: {year}_kia_{MODEL}_Owner's Manual.pdf (lowercase make, UPPERCASE model)
    (2024, "Kia", "Niro", "NIRO", "kia"),
    (2024, "Kia", "Soul", "SOUL", "kia"),
    (2014, "Kia", "Soul", "SOUL", "kia"),

    # Lincoln - pattern: {year}_lincoln_{model}_Owner's Manual Printing N PDF.pdf (curly apostrophe)
    (2021, "Lincoln", "Aviator", "aviator", "lincoln"),
    (2022, "Lincoln", "Aviator", "aviator", "lincoln"),
    (2019, "Lincoln", "Continental", "continental", "lincoln"),
    (2022, "Lincoln", "Corsair", "corsair", "lincoln"),
    (2023, "Lincoln", "Corsair", "corsair", "lincoln"),
    (2024, "Lincoln", "Corsair", "corsair", "lincoln"),
    (2018, "Lincoln", "Mkc", "mkc", "lincoln"),
    (2018, "Lincoln", "Mkt", "mkt", "lincoln"),
    (2018, "Lincoln", "Mkz", "mkz", "lincoln"),
    (2019, "Lincoln", "Mkz", "mkz", "lincoln"),
    (2019, "Lincoln", "Nautilus", "nautilus", "lincoln"),
    (2018, "Lincoln", "Navigator", "navigator", "lincoln"),
    (2019, "Lincoln", "Navigator", "navigator", "lincoln"),
    (2023, "Lincoln", "Navigator", "navigator", "lincoln"),

    # Maserati - pattern: {year}_maserati_{Model}_Owner's Manual.pdf (lowercase make, Title model)
    (2020, "Maserati", "Ghibli", "Ghibli", "maserati"),
    (2023, "Maserati", "Ghibli", "Ghibli", "maserati"),
    (2017, "Maserati", "Levante", "Levante", "maserati"),
    (2018, "Maserati", "Levante", "Levante", "maserati"),
    (2022, "Maserati", "Quattroporte", "Quattroporte", "maserati"),
]


def get_vhr_url(year: int, make: str, vhr_model: str, url_style: str = "stellantis") -> str:
    """Build VHR URL based on url_style parameter."""
    make_lower = make.lower()

    if url_style == 'kia':
        # Kia pattern: {year}_kia_{MODEL}_Owner's Manual.pdf (lowercase make, UPPERCASE model)
        return f"{VHR_BASE}/kia/{year}_kia_{vhr_model}_Owner{STRAIGHT_APOS}s%20Manual.pdf"

    elif url_style == 'maserati':
        # Maserati pattern: {year}_maserati_{Model}_Owner's Manual.pdf (lowercase make, Title model)
        return f"{VHR_BASE}/maserati/{year}_maserati_{vhr_model}_Owner{STRAIGHT_APOS}s%20Manual.pdf"

    elif url_style == 'stellantis':
        # Stellantis pattern: {year}_{Make}_{Model}_Owner's Manual.pdf (Title case, straight apostrophe)
        return f"{VHR_BASE}/{make_lower}/{year}_{make}_{vhr_model}_Owner{STRAIGHT_APOS}s%20Manual.pdf"

    elif url_style == 'ford':
        # Ford pattern: {year}_ford_{model}_Owner's Manual Printing 1 PDF.pdf (curly apostrophe)
        return f"{VHR_BASE}/ford/{year}_ford_{vhr_model}_Owner{CURLY_APOS}s%20Manual%20Printing%201%20PDF.pdf"

    elif url_style == 'lincoln':
        # Lincoln pattern: {year}_lincoln_{model}_Owner's Manual Printing 1 PDF.pdf (curly apostrophe)
        return f"{VHR_BASE}/lincoln/{year}_lincoln_{vhr_model}_Owner{CURLY_APOS}s%20Manual%20Printing%201%20PDF.pdf"

    elif url_style == 'acura':
        # Acura pattern: {year}_acura_{model}_{year} {MODEL} Owner's Manual.pdf
        model_display = vhr_model.upper()
        return f"{VHR_BASE}/acura/{year}_acura_{vhr_model}_{year}%20{model_display}%20Owner{STRAIGHT_APOS}s%20Manual.pdf"

    elif url_style == 'infiniti':
        # Infiniti pattern: {year}_infiniti_{Model}_Owner's Manual.pdf
        return f"{VHR_BASE}/infiniti/{year}_infiniti_{vhr_model}_Owner{STRAIGHT_APOS}s%20Manual.pdf"

    else:
        # GM pattern: {year}_{make}_{Model}_{year} {Make} {Model} Owner Manual.pdf
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


def fix_manual(year: int, make: str, model: str, vhr_model: str, url_style: str = "stellantis", dry_run: bool = True) -> bool:
    """Fix a single mismatched manual."""
    vhr_url = get_vhr_url(year, make, vhr_model, url_style)

    print(f"\n{'[DRY RUN] ' if dry_run else ''}{year} {make} {model}")
    print(f"  VHR URL: {vhr_url}")

    # Find existing record
    existing = supabase.table('vehicle_manuals').select('id, pdf_year, year_mismatch').eq(
        'make', make
    ).eq('model', model).eq('year', year).execute()

    if not existing.data:
        print(f"  SKIP: No record found in database")
        return False

    record = existing.data[0]
    if not record.get('year_mismatch'):
        print(f"  SKIP: Not marked as mismatched")
        return False

    print(f"  Current PDF year: {record.get('pdf_year')} (mismatched)")

    # Check if VHR has it
    info = get_pdf_info(vhr_url)
    if not info['exists']:
        print(f"  SKIP: VHR doesn't have this ({info})")
        return False

    size_mb = info['size'] / 1024 / 1024
    print(f"  VHR size: {size_mb:.1f} MB")

    if dry_run:
        print(f"  Would replace with correct {year} PDF")
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
        try:
            record_id = record['id']

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

            print(f"    ✅ Fixed! Updated record (id={record_id})")
        except Exception as e:
            print(f"    DB update failed: {e}")
            return False

    return True


def main():
    dry_run = '--run' not in sys.argv

    print("=" * 70)
    print("VHR Mismatch Fixer")
    print("=" * 70)

    if dry_run:
        print("\nDRY RUN MODE - No changes will be made")
        print("Run with --run to actually fix\n")
    else:
        print("\nLIVE MODE - Will download and fix manuals\n")

    print(f"Manuals to fix: {len(MANUALS_TO_FIX)}")

    # Group by make
    by_make = {}
    for m in MANUALS_TO_FIX:
        by_make[m[1]] = by_make.get(m[1], 0) + 1
    print("\nBy make:")
    for make, count in sorted(by_make.items()):
        print(f"  {make}: {count}")

    success = 0
    failed = 0
    skipped = 0

    for year, make, model, vhr_model, url_style in MANUALS_TO_FIX:
        result = fix_manual(year, make, model, vhr_model, url_style, dry_run)
        if result:
            success += 1
        elif result is None:
            skipped += 1
        else:
            failed += 1

        if not dry_run:
            time.sleep(1)  # Be nice to VHR servers

    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"Success: {success}")
    print(f"Failed: {failed}")
    print(f"Skipped: {skipped}")

    if dry_run:
        print("\nRun with --run to actually fix these manuals")


if __name__ == "__main__":
    main()
