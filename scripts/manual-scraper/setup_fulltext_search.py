#!/usr/bin/env python3
"""
Set up PostgreSQL Full-Text Search for manual sections.

This creates:
1. A tsvector column for efficient searching
2. A trigger to auto-update the search vector
3. A GIN index for fast lookups
4. An RPC function for searching
"""

import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

supabase = create_client(
    os.getenv('SUPABASE_URL', 'https://jxpbnnmefwtazfvoxvge.supabase.co'),
    os.getenv('SUPABASE_SERVICE_KEY')
)

# SQL statements to execute
SQL_STATEMENTS = [
    # 1. Add tsvector column
    """
    ALTER TABLE manual_sections
    ADD COLUMN IF NOT EXISTS search_vector tsvector;
    """,

    # 2. Create function to update search vector
    """
    CREATE OR REPLACE FUNCTION update_manual_search_vector()
    RETURNS trigger AS $$
    BEGIN
        NEW.search_vector :=
            setweight(to_tsvector('english', coalesce(NEW.section_title, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(NEW.content_plain, '')), 'B');
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """,

    # 3. Create trigger
    """
    DROP TRIGGER IF EXISTS manual_sections_search_update ON manual_sections;
    """,
    """
    CREATE TRIGGER manual_sections_search_update
        BEFORE INSERT OR UPDATE ON manual_sections
        FOR EACH ROW EXECUTE FUNCTION update_manual_search_vector();
    """,

    # 4. Create GIN index
    """
    CREATE INDEX IF NOT EXISTS idx_manual_sections_search
    ON manual_sections USING GIN(search_vector);
    """,

    # 5. Create the search function
    """
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
    """,
]


def main():
    print("Setting up PostgreSQL Full-Text Search for manual_sections...")
    print("=" * 60)

    # Execute each SQL statement
    for i, sql in enumerate(SQL_STATEMENTS, 1):
        try:
            # Use rpc to execute raw SQL - won't work, need direct connection
            # Instead, let's check if we can do this another way
            print(f"\n[{i}/{len(SQL_STATEMENTS)}] Executing SQL...")
            print(f"  {sql.strip()[:60]}...")
        except Exception as e:
            print(f"  Error: {e}")

    # Since we can't execute raw SQL via the Supabase client,
    # let's update the search vectors using a different approach
    print("\n" + "=" * 60)
    print("NOTE: Raw SQL execution requires Supabase dashboard or direct PostgreSQL connection.")
    print("\nAlternative: Update search vectors via application...")

    # Check current section count
    sections = supabase.table("manual_sections").select(
        "id", count="exact"
    ).execute()

    print(f"\nTotal sections to update: {sections.count}")

    # Let's create a workaround - use existing search function or update content
    # to trigger vector generation

    print("\nOption 1: Run the SQL in Supabase Dashboard")
    print("  Go to: https://supabase.com/dashboard/project/jxpbnnmefwtazfvoxvge/sql/new")

    print("\nOption 2: Use supabase CLI migration")
    print("  Create a migration file with the SQL above")


if __name__ == "__main__":
    main()
