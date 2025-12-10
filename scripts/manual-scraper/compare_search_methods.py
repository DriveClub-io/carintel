#!/usr/bin/env python3
"""
Compare search methods for manual sections:
1. ILIKE - Simple pattern matching
2. Full-Text Search (FTS) - PostgreSQL tsvector with stemming
3. Semantic/Vector Search - Requires embeddings (not yet implemented)

This demonstrates the trade-offs between each approach.
"""

import os
from dotenv import load_dotenv
from supabase import create_client
import time

load_dotenv()

supabase = create_client(
    os.getenv('SUPABASE_URL'),
    os.getenv('SUPABASE_SERVICE_KEY')
)


def search_ilike(manual_id: str, query: str) -> tuple[list, float]:
    """ILIKE pattern matching"""
    start = time.time()
    result = supabase.table("manual_sections").select(
        "section_title, content_plain, char_count"
    ).eq("manual_id", manual_id).ilike(
        "content_plain", f"%{query}%"
    ).execute()
    return result.data, (time.time() - start) * 1000


def search_fts(manual_id: str, query: str) -> tuple[list, float]:
    """PostgreSQL Full-Text Search"""
    start = time.time()
    # Convert query to tsquery format
    words = query.split()
    fts_query = " | ".join(f"'{w}'" for w in words)
    result = supabase.table("manual_sections").select(
        "section_title, content_plain, char_count"
    ).eq("manual_id", manual_id).text_search(
        "content_plain", fts_query
    ).execute()
    return result.data, (time.time() - start) * 1000


def main():
    # Get a Ford F-150 manual
    manual = supabase.table('vehicle_manuals').select(
        'id, year, make, model'
    ).eq('content_status', 'extracted').eq('make', 'Ford').limit(1).execute()

    if not manual.data:
        print("No Ford manual found")
        return

    manual_id = manual.data[0]['id']
    name = f"{manual.data[0]['year']} {manual.data[0]['make']} {manual.data[0]['model']}"

    print(f"""
SEARCH METHOD COMPARISON
{'='*70}
Manual: {name}
""")

    # Test scenarios
    scenarios = [
        {
            "name": "Direct keyword match",
            "query": "tow",
            "expected": "Should find towing-related content",
        },
        {
            "name": "User phrase",
            "query": "how to tow",
            "expected": "ILIKE needs exact match, FTS finds any word",
        },
        {
            "name": "Synonym - 'pull' for 'tow'",
            "query": "pull trailer",
            "expected": "Neither method understands synonyms",
        },
        {
            "name": "Natural question",
            "query": "what can i pull with my truck",
            "expected": "Needs semantic understanding",
        },
        {
            "name": "Technical term variation",
            "query": "engine lubricant",
            "expected": "'oil' won't be found",
        },
    ]

    for scenario in scenarios:
        print(f"\n{scenario['name'].upper()}")
        print(f"Query: \"{scenario['query']}\"")
        print(f"Expected: {scenario['expected']}")
        print("-" * 70)

        # ILIKE
        ilike_results, ilike_time = search_ilike(manual_id, scenario['query'])
        print(f"  ILIKE:  {len(ilike_results):3d} results ({ilike_time:5.0f}ms)")

        # FTS
        fts_results, fts_time = search_fts(manual_id, scenario['query'])
        print(f"  FTS:    {len(fts_results):3d} results ({fts_time:5.0f}ms)")

        # Show sample results if any
        if fts_results:
            print(f"  Sample: {fts_results[0]['section_title'][:50]}")

    print(f"""

SUMMARY
{'='*70}
Method      | Best For                    | Limitations
------------|-----------------------------|--------------------------
ILIKE       | Exact substring matching    | No stemming, no ranking
FTS         | Word matching with stemming | No semantic understanding
Vector      | Semantic similarity         | Requires embeddings, API costs

Current Status:
- ILIKE: Works (used in MCP search_manual tool)
- FTS: Works (available via Supabase .text_search())
- Vector: Schema ready (embedding column exists), needs OpenAI API key

To enable semantic search:
1. Add OPENAI_API_KEY to .env
2. Run embedding generation script
3. Use cosine similarity for search
""")


if __name__ == "__main__":
    main()
