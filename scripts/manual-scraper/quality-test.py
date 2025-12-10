#!/usr/bin/env python3
"""
Quality test script for extracted manual content

Evaluates the quality of extracted markdown content and identifies
manuals that may need re-extraction.

Usage:
  python quality-test.py                  # Test all extracted manuals
  python quality-test.py --limit 10       # Test only 10 manuals
  python quality-test.py --method marker-pdf  # Filter by extraction method
  python quality-test.py --verbose        # Show detailed output
  python quality-test.py --fix            # Mark low-quality as pending for re-extraction
"""

import os
import sys
import re
import argparse
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

from supabase import create_client, Client

SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://jxpbnnmefwtazfvoxvge.supabase.co')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_KEY')

if not SUPABASE_KEY:
    print("❌ SUPABASE_SERVICE_KEY required")
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# Quality thresholds
MIN_CONTENT_LENGTH = 5000       # Minimum characters (manuals should be substantial)
MIN_SECTIONS = 5                # Minimum number of sections
MIN_HEADERS = 3                 # Minimum markdown headers
MAX_GARBLED_RATIO = 0.05        # Max ratio of garbled text patterns
MIN_WORD_LENGTH_AVG = 3.5       # Average word length (garbled text has weird lengths)
MAX_SPECIAL_CHAR_RATIO = 0.15   # Max ratio of special characters


def check_garbled_text(content: str) -> tuple[float, list[str]]:
    """
    Check for garbled text patterns common in bad PDF extraction
    Returns (ratio, examples)
    """
    patterns = [
        r'[a-z]\s[a-z]\s[a-z]\s[a-z]',  # Spaced out characters: "t h i s"
        r'[A-Z]{10,}',                    # Long uppercase strings
        r'[\x00-\x08\x0b\x0c\x0e-\x1f]',  # Control characters
        r'[^\x00-\x7F]{5,}',              # Long non-ASCII sequences
        r'\d{20,}',                        # Very long numbers
        r'([a-zA-Z])\1{4,}',              # Repeated characters: "aaaaa"
    ]

    total_matches = 0
    examples = []

    for pattern in patterns:
        matches = re.findall(pattern, content)
        total_matches += len(matches)
        if matches and len(examples) < 3:
            examples.extend(matches[:2])

    ratio = total_matches / max(len(content), 1)
    return ratio, examples[:5]


def check_character_spacing(content: str) -> float:
    """
    Check for character spacing issues (common in pdfjs extraction)
    Returns ratio of spaced-out words
    """
    # Pattern for words with spaces between each character
    spaced_pattern = r'\b[a-zA-Z]\s[a-zA-Z]\s[a-zA-Z]\b'
    matches = re.findall(spaced_pattern, content)

    words = content.split()
    if not words:
        return 0

    return len(matches) / len(words)


def check_headers(content: str) -> tuple[int, list[str]]:
    """
    Check for proper markdown headers
    Returns (count, sample_headers)
    """
    header_pattern = r'^#{1,6}\s+(.+)$'
    matches = re.findall(header_pattern, content, re.MULTILINE)
    return len(matches), matches[:5]


def calculate_avg_word_length(content: str) -> float:
    """Calculate average word length (garbled text often has unusual lengths)"""
    words = re.findall(r'\b[a-zA-Z]+\b', content)
    if not words:
        return 0
    return sum(len(w) for w in words) / len(words)


def calculate_special_char_ratio(content: str) -> float:
    """Calculate ratio of special characters to total"""
    if not content:
        return 0
    special = len(re.findall(r'[^a-zA-Z0-9\s\.\,\!\?\-\:\;\'\"\(\)]', content))
    return special / len(content)


def evaluate_quality(content: str, sections: list) -> dict:
    """
    Evaluate the quality of extracted content
    Returns quality metrics and pass/fail status
    """
    metrics = {
        'content_length': len(content),
        'section_count': len(sections),
        'header_count': 0,
        'sample_headers': [],
        'garbled_ratio': 0,
        'garbled_examples': [],
        'spacing_ratio': 0,
        'avg_word_length': 0,
        'special_char_ratio': 0,
        'issues': [],
        'score': 100,
        'passed': True
    }

    # Check content length
    if metrics['content_length'] < MIN_CONTENT_LENGTH:
        metrics['issues'].append(f"Content too short: {metrics['content_length']:,} chars (min: {MIN_CONTENT_LENGTH:,})")
        metrics['score'] -= 30

    # Check section count
    if metrics['section_count'] < MIN_SECTIONS:
        metrics['issues'].append(f"Too few sections: {metrics['section_count']} (min: {MIN_SECTIONS})")
        metrics['score'] -= 20

    # Check headers
    metrics['header_count'], metrics['sample_headers'] = check_headers(content)
    if metrics['header_count'] < MIN_HEADERS:
        metrics['issues'].append(f"Too few headers: {metrics['header_count']} (min: {MIN_HEADERS})")
        metrics['score'] -= 15

    # Check for garbled text
    metrics['garbled_ratio'], metrics['garbled_examples'] = check_garbled_text(content)
    if metrics['garbled_ratio'] > MAX_GARBLED_RATIO:
        metrics['issues'].append(f"High garbled text ratio: {metrics['garbled_ratio']:.2%} (max: {MAX_GARBLED_RATIO:.2%})")
        metrics['score'] -= 25

    # Check character spacing
    metrics['spacing_ratio'] = check_character_spacing(content)
    if metrics['spacing_ratio'] > 0.01:  # More than 1% spaced words is bad
        metrics['issues'].append(f"Character spacing issues: {metrics['spacing_ratio']:.2%}")
        metrics['score'] -= 20

    # Check average word length
    metrics['avg_word_length'] = calculate_avg_word_length(content)
    if metrics['avg_word_length'] < MIN_WORD_LENGTH_AVG:
        metrics['issues'].append(f"Low avg word length: {metrics['avg_word_length']:.1f} (min: {MIN_WORD_LENGTH_AVG})")
        metrics['score'] -= 15

    # Check special character ratio
    metrics['special_char_ratio'] = calculate_special_char_ratio(content)
    if metrics['special_char_ratio'] > MAX_SPECIAL_CHAR_RATIO:
        metrics['issues'].append(f"High special char ratio: {metrics['special_char_ratio']:.2%} (max: {MAX_SPECIAL_CHAR_RATIO:.2%})")
        metrics['score'] -= 10

    # Determine pass/fail
    metrics['score'] = max(0, metrics['score'])
    metrics['passed'] = metrics['score'] >= 70 and len(metrics['issues']) <= 2

    return metrics


def get_extracted_manuals(limit: Optional[int] = None, method: Optional[str] = None):
    """Get manuals with extracted content"""
    query = supabase.table('vehicle_manuals').select(
        'id, year, make, model, variant'
    ).eq('content_status', 'extracted')

    if limit:
        query = query.limit(limit)

    result = query.execute()
    return result.data


def get_manual_content(manual_id: str) -> tuple[str, list]:
    """Get content and sections for a manual"""
    # Get full content
    content_result = supabase.table('manual_content').select(
        'content_markdown, extraction_method'
    ).eq('manual_id', manual_id).execute()

    content = ''
    method = 'unknown'
    if content_result.data:
        content = content_result.data[0].get('content_markdown', '')
        method = content_result.data[0].get('extraction_method', 'unknown')

    # Get sections
    sections_result = supabase.table('manual_sections').select(
        'section_title, content_markdown'
    ).eq('manual_id', manual_id).execute()

    sections = sections_result.data or []

    return content, sections, method


def main():
    parser = argparse.ArgumentParser(description='Test quality of extracted manual content')
    parser.add_argument('--limit', type=int, help='Limit number of manuals to test')
    parser.add_argument('--method', type=str, help='Filter by extraction method')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show detailed output')
    parser.add_argument('--fix', action='store_true', help='Mark low-quality manuals as pending for re-extraction')
    args = parser.parse_args()

    print("🔍 Manual Content Quality Test")
    print("=" * 50)

    # Get extracted manuals
    manuals = get_extracted_manuals(limit=args.limit)

    if not manuals:
        print("No extracted manuals found!")
        return

    print(f"\n📋 Testing {len(manuals)} extracted manuals...\n")

    results = {
        'passed': 0,
        'failed': 0,
        'by_method': {},
        'failed_manuals': []
    }

    for i, manual in enumerate(manuals, 1):
        name = f"{manual['year']} {manual['make']} {manual['model']}"

        # Get content
        content, sections, method = get_manual_content(manual['id'])

        # Filter by method if specified
        if args.method and method != args.method:
            continue

        # Track by method
        if method not in results['by_method']:
            results['by_method'][method] = {'passed': 0, 'failed': 0}

        # Evaluate quality
        metrics = evaluate_quality(content, sections)

        if metrics['passed']:
            results['passed'] += 1
            results['by_method'][method]['passed'] += 1
            status = "✅ PASS"
        else:
            results['failed'] += 1
            results['by_method'][method]['failed'] += 1
            results['failed_manuals'].append({
                'id': manual['id'],
                'name': name,
                'method': method,
                'score': metrics['score'],
                'issues': metrics['issues']
            })
            status = "❌ FAIL"

        if args.verbose or not metrics['passed']:
            print(f"[{i}/{len(manuals)}] {status} {name}")
            print(f"    Method: {method}")
            print(f"    Score: {metrics['score']}/100")
            print(f"    Content: {metrics['content_length']:,} chars, {metrics['section_count']} sections")
            if metrics['issues']:
                for issue in metrics['issues']:
                    print(f"    ⚠️  {issue}")
            if metrics['garbled_examples'] and args.verbose:
                print(f"    Garbled samples: {metrics['garbled_examples'][:3]}")
            print()
        elif i % 10 == 0:
            print(f"  Tested {i}/{len(manuals)}...")

    # Print summary
    print("\n" + "=" * 50)
    print("📊 QUALITY TEST SUMMARY")
    print("=" * 50)

    total = results['passed'] + results['failed']
    if total > 0:
        pass_rate = (results['passed'] / total) * 100
        print(f"\n  Total tested: {total}")
        print(f"  ✅ Passed: {results['passed']} ({pass_rate:.1f}%)")
        print(f"  ❌ Failed: {results['failed']} ({100-pass_rate:.1f}%)")

    print("\n  By Extraction Method:")
    for method, counts in results['by_method'].items():
        total_method = counts['passed'] + counts['failed']
        if total_method > 0:
            rate = (counts['passed'] / total_method) * 100
            print(f"    {method}: {counts['passed']}/{total_method} passed ({rate:.1f}%)")

    if results['failed_manuals']:
        print(f"\n  Failed manuals ({len(results['failed_manuals'])}):")
        for fm in results['failed_manuals'][:10]:
            print(f"    - {fm['name']} (score: {fm['score']}, method: {fm['method']})")
        if len(results['failed_manuals']) > 10:
            print(f"    ... and {len(results['failed_manuals']) - 10} more")

    # Fix option: mark failed manuals for re-extraction
    if args.fix and results['failed_manuals']:
        print(f"\n🔧 Marking {len(results['failed_manuals'])} failed manuals for re-extraction...")
        for fm in results['failed_manuals']:
            supabase.table('vehicle_manuals').update({
                'content_status': 'pending'
            }).eq('id', fm['id']).execute()
        print("  Done! These will be re-extracted with marker-pdf.")

    print()


if __name__ == '__main__':
    main()
