#!/usr/bin/env python3
"""
Run full-text search migration via Supabase SQL API.
Since we can't use supabase db push (lock timeout), we'll run the SQL directly.
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://jxpbnnmefwtazfvoxvge.supabase.co')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_KEY')

# SQL statements to execute one at a time
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

    # 3. Drop and create trigger
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

    # 6. Grant permissions
    """
    GRANT EXECUTE ON FUNCTION search_manual_fulltext TO anon, authenticated, service_role;
    """,
]

# Update existing rows SQL (run separately since it may take time)
UPDATE_SQL = """
UPDATE manual_sections
SET search_vector =
    setweight(to_tsvector('english', coalesce(section_title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_plain, '')), 'B')
WHERE search_vector IS NULL;
"""


def run_sql_via_rpc(sql: str) -> dict:
    """Execute SQL via Supabase edge function or direct connection"""
    # Unfortunately, Supabase REST API doesn't allow arbitrary SQL execution
    # We need to use a different approach
    pass


def main():
    print("Full-Text Search Migration")
    print("=" * 60)
    print()
    print("The Supabase REST API doesn't allow arbitrary SQL execution.")
    print("Please run this SQL in the Supabase Dashboard SQL Editor:")
    print()
    print("https://supabase.com/dashboard/project/jxpbnnmefwtazfvoxvge/sql/new")
    print()
    print("=" * 60)
    print()

    # Print all SQL as one block
    all_sql = "\n".join(SQL_STATEMENTS) + "\n\n-- Update existing rows (may take a moment)\n" + UPDATE_SQL

    print(all_sql)

    print()
    print("=" * 60)
    print("After running the SQL above, test with:")
    print("  python test_fts_search.py")


if __name__ == "__main__":
    main()
