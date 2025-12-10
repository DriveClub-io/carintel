#!/usr/bin/env python3
"""
Backfill sections for manuals that have content but no sections.
This parses the existing markdown content and creates section entries.
"""

import os
import re
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase = create_client(
    os.getenv('SUPABASE_URL', 'https://jxpbnnmefwtazfvoxvge.supabase.co'),
    os.getenv('SUPABASE_SERVICE_KEY')
)


def parse_sections(markdown: str) -> list:
    """Parse markdown into sections based on headers"""
    sections = []
    current_title = "Introduction"
    current_content = []

    for line in markdown.split("\n"):
        header_match = re.match(r"^(#{1,3})\s+(.+)$", line)
        if header_match:
            # Save previous section
            if current_content:
                sections.append({
                    "title": current_title,
                    "content": "\n".join(current_content).strip(),
                })
            current_title = header_match.group(2).strip()
            current_content = []
        else:
            current_content.append(line)

    # Save last section
    if current_content:
        sections.append({
            "title": current_title,
            "content": "\n".join(current_content).strip(),
        })

    return sections


def backfill_manual_sections(manual_id: str, content_markdown: str) -> int:
    """Parse content and insert sections for a manual"""
    # Delete any existing sections first
    supabase.table("manual_sections").delete().eq("manual_id", manual_id).execute()

    # Parse sections
    sections = parse_sections(content_markdown)

    # Insert new sections
    inserted = 0
    for i, section in enumerate(sections):
        if not section["content"].strip():
            continue
        try:
            supabase.table("manual_sections").insert({
                "manual_id": manual_id,
                "section_path": str(i + 1),
                "section_title": section["title"],
                "sort_order": i,
                "depth": 1,
                "content_markdown": section["content"],
                "content_plain": section["content"],
                "char_count": len(section["content"]),
                "word_count": len(section["content"].split()),
            }).execute()
            inserted += 1
        except Exception as e:
            print(f"  Error inserting section {i}: {str(e)[:100]}")

    return inserted


def main():
    # Get all extracted manuals
    extracted = supabase.table('vehicle_manuals').select(
        'id, year, make, model'
    ).eq('content_status', 'extracted').execute()

    print(f"Found {len(extracted.data)} extracted manuals")

    processed = 0
    skipped = 0

    for manual in extracted.data:
        manual_id = manual['id']
        name = f"{manual['year']} {manual['make']} {manual['model']}"

        # Check if sections already exist
        existing = supabase.table('manual_sections').select(
            'id', count='exact'
        ).eq('manual_id', manual_id).execute()

        if existing.count > 0:
            print(f"[SKIP] {name} - already has {existing.count} sections")
            skipped += 1
            continue

        # Get content
        content = supabase.table('manual_content').select(
            'content_markdown'
        ).eq('manual_id', manual_id).execute()

        if not content.data:
            print(f"[SKIP] {name} - no content found")
            skipped += 1
            continue

        # Backfill sections
        markdown = content.data[0]['content_markdown']
        section_count = backfill_manual_sections(manual_id, markdown)

        print(f"[DONE] {name} - inserted {section_count} sections")
        processed += 1

    print(f"\n{'='*50}")
    print(f"Backfill complete!")
    print(f"  Processed: {processed}")
    print(f"  Skipped: {skipped}")


if __name__ == "__main__":
    main()
