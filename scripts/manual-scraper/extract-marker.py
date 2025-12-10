#!/usr/bin/env python3
"""
Parallel PDF to Markdown extraction using marker-pdf

Processes PDFs in parallel batches and stores results in Supabase.

Usage:
  python extract-marker.py                    # Process all pending
  python extract-marker.py --workers 2        # Use 2 parallel workers
  python extract-marker.py --limit 10         # Process only 10 files
  python extract-marker.py --reprocess        # Re-extract already processed
  python extract-marker.py --status           # Show progress stats only
"""

import os
import sys
import re
import json
import argparse
import subprocess
from pathlib import Path
from datetime import datetime
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Optional
import hashlib

# Load environment
from dotenv import load_dotenv
load_dotenv()

from supabase import create_client, Client

SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://jxpbnnmefwtazfvoxvge.supabase.co')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_KEY')
MANUALS_DIR = Path('./manuals')
OUTPUT_DIR = Path('./marker_output')

if not SUPABASE_KEY:
    print("❌ SUPABASE_SERVICE_KEY required")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def get_stats():
    """Get current processing statistics"""
    total = supabase.table('vehicle_manuals').select('id', count='exact').execute()
    pending = supabase.table('vehicle_manuals').select('id', count='exact').eq('content_status', 'pending').execute()
    extracting = supabase.table('vehicle_manuals').select('id', count='exact').eq('content_status', 'extracting').execute()
    extracted = supabase.table('vehicle_manuals').select('id', count='exact').eq('content_status', 'extracted').execute()
    failed = supabase.table('vehicle_manuals').select('id', count='exact').eq('content_status', 'failed').execute()

    return {
        'total': total.count,
        'pending': pending.count,
        'extracting': extracting.count,
        'extracted': extracted.count,
        'failed': failed.count
    }


def print_stats():
    """Print current statistics"""
    stats = get_stats()
    print("\n📊 EXTRACTION PROGRESS")
    print("=" * 40)
    print(f"  Total manuals:     {stats['total']:,}")
    print(f"  ✅ Extracted:      {stats['extracted']:,}")
    print(f"  ⏳ Pending:        {stats['pending']:,}")
    print(f"  🔄 Extracting:     {stats['extracting']:,}")
    print(f"  ❌ Failed:         {stats['failed']:,}")

    if stats['total'] > 0:
        pct = (stats['extracted'] / stats['total']) * 100
        print(f"\n  Progress: {pct:.1f}%")
    print()


def get_pending_manuals(limit: Optional[int] = None, reprocess: bool = False):
    """Get list of manuals to process"""
    query = supabase.table('vehicle_manuals').select(
        'id, year, make, model, variant, pdf_storage_path, pdf_url, content_status'
    )

    if reprocess:
        # Get all with PDF
        query = query.or_('pdf_storage_path.not.is.null,pdf_url.not.is.null')
    else:
        # Only pending or failed
        query = query.in_('content_status', ['pending', 'failed'])

    query = query.order('year', desc=True)

    if limit:
        query = query.limit(limit)

    result = query.execute()
    return result.data


def to_slug(text: str) -> str:
    """Convert text to filename-safe slug"""
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')


def find_local_pdf(manual: dict) -> Optional[Path]:
    """Find the local PDF file for a manual"""
    year = manual['year']
    make = to_slug(manual['make'])
    model = to_slug(manual['model'])
    variant = to_slug(manual['variant']) if manual.get('variant') else ''

    # Try different filename patterns
    patterns = [
        f"{year}-{make}-{model}{'-' + variant if variant else ''}.pdf",
        f"{year}-{make}-{model}.pdf",
    ]

    for pattern in patterns:
        path = MANUALS_DIR / pattern
        if path.exists():
            return path

    # Fallback: search for matching files
    for pdf in MANUALS_DIR.glob(f"{year}-{make}-{model}*.pdf"):
        return pdf

    return None


def parse_markdown_sections(markdown_content: str) -> list:
    """Parse markdown into sections based on headers"""
    sections = []
    lines = markdown_content.split('\n')

    current_section = None
    section_counter = 0
    chapter_counter = 0

    for line in lines:
        # Check for headers
        header_match = re.match(r'^(#{1,6})\s+(.+)$', line)

        if header_match:
            # Save previous section
            if current_section and current_section['content'].strip():
                sections.append(current_section)

            level = len(header_match.group(1))
            title = header_match.group(2).strip()

            # Clean title (remove markdown formatting)
            title = re.sub(r'\*+', '', title)
            title = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', title)
            title = title.strip()

            if level == 1:
                chapter_counter += 1
                section_counter = 0
                path = str(chapter_counter)
            else:
                section_counter += 1
                path = f"{chapter_counter}.{section_counter}"

            current_section = {
                'path': path,
                'title': title[:200],
                'content': line + '\n',
                'depth': level - 1
            }
        elif current_section:
            current_section['content'] += line + '\n'
        else:
            # Content before first header
            if not current_section:
                current_section = {
                    'path': '0',
                    'title': 'Introduction',
                    'content': line + '\n',
                    'depth': 0
                }

    # Don't forget the last section
    if current_section and current_section['content'].strip():
        sections.append(current_section)

    # Filter out very short sections
    sections = [s for s in sections if len(s['content'].strip()) > 50]

    return sections


def extract_keywords(content: str, title: str) -> list:
    """Extract automotive keywords from content"""
    keywords = set()

    auto_terms = [
        'tire', 'oil', 'brake', 'engine', 'battery', 'fuel', 'light', 'warning',
        'maintenance', 'safety', 'airbag', 'seat', 'belt', 'door', 'window',
        'mirror', 'wiper', 'filter', 'fluid', 'pressure', 'temperature', 'gauge',
        'dashboard', 'instrument', 'control', 'switch', 'button', 'key', 'fob',
        'start', 'stop', 'drive', 'park', 'reverse', 'neutral', 'transmission',
        'cruise', 'lane', 'assist', 'camera', 'sensor', 'navigation', 'audio',
        'bluetooth', 'phone', 'climate', 'ac', 'heat', 'defrost', 'vent'
    ]

    text = (title + ' ' + content).lower()

    for term in auto_terms:
        if term in text:
            keywords.add(term)

    # Add title words
    for word in title.lower().split():
        word = re.sub(r'[^a-z]', '', word)
        if len(word) > 3:
            keywords.add(word)

    return list(keywords)[:20]


def process_single_pdf(manual: dict) -> dict:
    """Process a single PDF with marker-pdf"""
    manual_id = manual['id']
    year = manual['year']
    make = manual['make']
    model = manual['model']
    variant = manual.get('variant', '')

    name = f"{year} {make} {model}{' ' + variant if variant else ''}"

    try:
        # Find local PDF
        pdf_path = find_local_pdf(manual)
        if not pdf_path:
            return {'id': manual_id, 'success': False, 'error': 'PDF not found locally'}

        # Create output directory
        output_subdir = OUTPUT_DIR / f"{year}-{to_slug(make)}-{to_slug(model)}"
        output_subdir.mkdir(parents=True, exist_ok=True)

        # Run marker-pdf (use full path since subprocess won't find venv bin)
        marker_bin = Path(__file__).parent / '.venv' / 'bin' / 'marker_single'
        result = subprocess.run(
            [
                str(marker_bin),
                str(pdf_path),
                '--output_dir', str(output_subdir),
                '--output_format', 'markdown'
            ],
            capture_output=True,
            text=True,
            timeout=3600  # 60 minute timeout (large PDFs need more time)
        )

        # Check for actual failure (not just warnings in stderr)
        # marker-pdf outputs warnings to stderr but still succeeds
        if result.returncode != 0:
            return {'id': manual_id, 'success': False, 'error': f'marker-pdf failed (exit {result.returncode}): {result.stderr[:500]}'}

        # Find the output markdown file
        md_files = list(output_subdir.glob('**/*.md'))
        if not md_files:
            return {'id': manual_id, 'success': False, 'error': 'No markdown output generated'}

        md_file = md_files[0]
        markdown_content = md_file.read_text(encoding='utf-8')

        # Parse sections
        sections = parse_markdown_sections(markdown_content)

        return {
            'id': manual_id,
            'success': True,
            'name': name,
            'markdown': markdown_content,
            'sections': sections,
            'num_sections': len(sections),
            'char_count': len(markdown_content)
        }

    except subprocess.TimeoutExpired:
        return {'id': manual_id, 'success': False, 'error': 'Timeout after 30 minutes'}
    except Exception as e:
        return {'id': manual_id, 'success': False, 'error': str(e)}


def save_to_database(result: dict) -> bool:
    """Save extraction result to database"""
    manual_id = result['id']

    if not result['success']:
        # Mark as failed
        supabase.table('vehicle_manuals').update({
            'content_status': 'failed',
            'error_message': result.get('error', 'Unknown error')
        }).eq('id', manual_id).execute()
        return False

    try:
        markdown = result['markdown']
        sections = result['sections']

        # Calculate token estimate
        total_tokens = len(markdown) // 4
        word_count = len(markdown.split())

        # Build TOC
        toc = [{
            'path': s['path'],
            'title': s['title'],
            'depth': s['depth'],
            'token_count': len(s['content']) // 4
        } for s in sections]

        # Delete existing sections
        supabase.table('manual_sections').delete().eq('manual_id', manual_id).execute()

        # Insert sections
        for section in sections:
            keywords = extract_keywords(section['content'], section['title'])

            supabase.table('manual_sections').insert({
                'manual_id': manual_id,
                'section_path': section['path'],
                'section_title': section['title'],
                'depth': section['depth'],
                'sort_order': int(section['path'].split('.')[-1]) if '.' in section['path'] else int(section['path']),
                'content_markdown': section['content'],
                'keywords': keywords
            }).execute()

        # Upsert full content
        supabase.table('manual_content').upsert({
            'manual_id': manual_id,
            'content_markdown': markdown,
            'table_of_contents': toc,
            'total_word_count': word_count,
            'total_char_count': len(markdown),
            'total_token_count': total_tokens,
            'extraction_method': 'marker-pdf',
            'extraction_quality': 0.95,
            'extracted_at': datetime.utcnow().isoformat()
        }, on_conflict='manual_id').execute()

        # Update manual status
        supabase.table('vehicle_manuals').update({
            'content_status': 'extracted',
            'content_extracted_at': datetime.utcnow().isoformat()
        }).eq('id', manual_id).execute()

        return True

    except Exception as e:
        supabase.table('vehicle_manuals').update({
            'content_status': 'failed',
            'error_message': str(e)
        }).eq('id', manual_id).execute()
        return False


def process_batch(manuals: list, workers: int = 2):
    """Process a batch of manuals in parallel"""
    total = len(manuals)
    succeeded = 0
    failed = 0

    print(f"\n🚀 Processing {total} manuals with {workers} workers...\n")

    # Mark all as extracting
    for manual in manuals:
        supabase.table('vehicle_manuals').update({
            'content_status': 'extracting'
        }).eq('id', manual['id']).execute()

    with ProcessPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(process_single_pdf, m): m for m in manuals}

        for i, future in enumerate(as_completed(futures), 1):
            manual = futures[future]
            name = f"{manual['year']} {manual['make']} {manual['model']}"

            try:
                result = future.result()

                if result['success']:
                    if save_to_database(result):
                        succeeded += 1
                        print(f"✅ [{i}/{total}] {name} - {result['num_sections']} sections, {result['char_count']:,} chars")
                    else:
                        failed += 1
                        print(f"❌ [{i}/{total}] {name} - DB save failed")
                else:
                    failed += 1
                    print(f"❌ [{i}/{total}] {name} - {result.get('error', 'Unknown error')[:80]}")
                    save_to_database(result)

            except Exception as e:
                failed += 1
                print(f"❌ [{i}/{total}] {name} - Exception: {str(e)[:80]}")

    return succeeded, failed


def main():
    parser = argparse.ArgumentParser(description='Extract PDF content using marker-pdf')
    parser.add_argument('--workers', type=int, default=2, help='Number of parallel workers (default: 2)')
    parser.add_argument('--limit', type=int, help='Limit number of files to process')
    parser.add_argument('--reprocess', action='store_true', help='Re-extract already processed files')
    parser.add_argument('--status', action='store_true', help='Show status only')
    args = parser.parse_args()

    print("📚 Marker-PDF Content Extraction")
    print("=" * 40)

    # Always show stats
    print_stats()

    if args.status:
        return

    # Create output directory
    OUTPUT_DIR.mkdir(exist_ok=True)

    # Get manuals to process
    manuals = get_pending_manuals(limit=args.limit, reprocess=args.reprocess)

    if not manuals:
        print("✨ No manuals to process!")
        return

    print(f"📋 Found {len(manuals)} manuals to process")

    # Process in batches
    succeeded, failed = process_batch(manuals, workers=args.workers)

    print("\n" + "=" * 40)
    print("📊 EXTRACTION COMPLETE")
    print("=" * 40)
    print(f"  ✅ Succeeded: {succeeded}")
    print(f"  ❌ Failed: {failed}")
    print()

    # Show final stats
    print_stats()


if __name__ == '__main__':
    main()
