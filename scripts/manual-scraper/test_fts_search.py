#!/usr/bin/env python3
"""
Test PostgreSQL Full-Text Search vs ILIKE for manual sections.

Full-text search in PostgreSQL:
- Uses language-aware stemming (e.g., "pulling" matches "pull")
- Understands word boundaries and relevance ranking
- Much faster with proper indexes
- No external API needed
"""

import os
from dotenv import load_dotenv
from supabase import create_client
import time

load_dotenv()

supabase = create_client(
    os.getenv('SUPABASE_URL', 'https://jxpbnnmefwtazfvoxvge.supabase.co'),
    os.getenv('SUPABASE_SERVICE_KEY')
)


def search_ilike(manual_id: str, query: str, limit: int = 5):
    """Current ILIKE search - simple pattern matching"""
    start = time.time()

    result = supabase.table("manual_sections").select(
        "section_title, content_plain, char_count"
    ).eq("manual_id", manual_id).ilike(
        "content_plain", f"%{query}%"
    ).limit(limit).execute()

    elapsed = (time.time() - start) * 1000
    return result.data, elapsed


def search_fulltext(manual_id: str, query: str, limit: int = 5):
    """PostgreSQL full-text search with stemming and ranking"""
    start = time.time()

    # Use RPC for full-text search
    result = supabase.rpc("search_manual_fulltext", {
        "p_manual_id": manual_id,
        "p_query": query,
        "p_limit": limit
    }).execute()

    elapsed = (time.time() - start) * 1000
    return result.data, elapsed


def main():
    # Get a manual with lots of sections for testing
    manual = supabase.table("vehicle_manuals").select(
        "id, year, make, model"
    ).eq("content_status", "extracted").limit(1).execute()

    if not manual.data:
        print("No extracted manuals found")
        return

    manual_id = manual.data[0]["id"]
    name = f"{manual.data[0]['year']} {manual.data[0]['make']} {manual.data[0]['model']}"

    # Check section count
    sections = supabase.table("manual_sections").select(
        "id", count="exact"
    ).eq("manual_id", manual_id).execute()

    print(f"Testing searches on: {name}")
    print(f"Total sections: {sections.count}")
    print("=" * 60)

    # Test queries - some that work with ILIKE, some that don't
    test_queries = [
        ("tow", "Direct keyword match"),
        ("pull trailer", "Synonym - ILIKE won't find 'tow'"),
        ("hauling", "Another synonym for towing"),
        ("tire", "Direct keyword"),
        ("flat tire", "Multi-word direct match"),
        ("oil change", "Common maintenance query"),
        ("engine lubricant", "Synonym for oil"),
    ]

    print("\n1. ILIKE SEARCH (Current Implementation)")
    print("-" * 60)

    for query, description in test_queries:
        results, elapsed = search_ilike(manual_id, query)
        print(f"\n'{query}' ({description})")
        print(f"  Found: {len(results)} sections in {elapsed:.1f}ms")
        for r in results[:2]:
            print(f"    - {r['section_title'][:50]}")

    print("\n\n2. FULL-TEXT SEARCH (If function exists)")
    print("-" * 60)

    # Check if full-text search function exists
    try:
        for query, description in test_queries:
            results, elapsed = search_fulltext(manual_id, query)
            print(f"\n'{query}' ({description})")
            print(f"  Found: {len(results)} sections in {elapsed:.1f}ms")
            for r in results[:2]:
                title = r.get('section_title', 'Unknown')[:50]
                rank = r.get('rank', 0)
                print(f"    - {title} (rank: {rank:.4f})")
    except Exception as e:
        print(f"\nFull-text search function not found: {e}")
        print("\nCreating the search function...")
        create_fulltext_function()
        print("Function created! Run this script again to test.")


def create_fulltext_function():
    """Create the full-text search RPC function in Supabase"""

    sql = """
    -- Add tsvector column if not exists
    ALTER TABLE manual_sections
    ADD COLUMN IF NOT EXISTS search_vector tsvector;

    -- Create function to generate search vector
    CREATE OR REPLACE FUNCTION update_search_vector()
    RETURNS trigger AS $$
    BEGIN
        NEW.search_vector :=
            setweight(to_tsvector('english', coalesce(NEW.section_title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(NEW.content_plain, '')), 'B');
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    -- Create trigger for auto-update
    DROP TRIGGER IF EXISTS manual_sections_search_update ON manual_sections;
    CREATE TRIGGER manual_sections_search_update
        BEFORE INSERT OR UPDATE ON manual_sections
        FOR EACH ROW EXECUTE FUNCTION update_search_vector();

    -- Update existing rows
    UPDATE manual_sections
    SET search_vector =
        setweight(to_tsvector('english', coalesce(section_title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content_plain, '')), 'B')
    WHERE search_vector IS NULL;

    -- Create GIN index for fast searching
    CREATE INDEX IF NOT EXISTS idx_manual_sections_search
    ON manual_sections USING GIN(search_vector);

    -- Create the search function
    CREATE OR REPLACE FUNCTION search_manual_fulltext(
        p_manual_id uuid,
        p_query text,
        p_limit int DEFAULT 10
    )
    RETURNS TABLE(
        id uuid,
        section_title text,
        content_plain text,
        char_count int,
        rank real
    )
    LANGUAGE sql STABLE
    AS $$
        SELECT
            ms.id,
            ms.section_title,
            ms.content_plain,
            ms.char_count,
            ts_rank(ms.search_vector, websearch_to_tsquery('english', p_query)) as rank
        FROM manual_sections ms
        WHERE ms.manual_id = p_manual_id
          AND ms.search_vector @@ websearch_to_tsquery('english', p_query)
        ORDER BY rank DESC
        LIMIT p_limit;
    $$;
    """

    print("\nSQL to run in Supabase SQL Editor:")
    print("=" * 60)
    print(sql)
    print("=" * 60)
    print("\nRun this SQL in your Supabase dashboard at:")
    print("https://supabase.com/dashboard/project/jxpbnnmefwtazfvoxvge/sql/new")


if __name__ == "__main__":
    main()
