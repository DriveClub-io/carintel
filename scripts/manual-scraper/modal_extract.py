"""
Modal-based PDF extraction using marker-pdf

This runs marker-pdf extractions on Modal's cloud infrastructure with:
- CPU-based processing (cheaper than GPU)
- 50+ parallel workers
- Auto-retry on failures
- Reliable execution

Usage:
  # Deploy and run
  modal run modal_extract.py

  # Run with specific limit
  modal run modal_extract.py --limit 100

  # Deploy as persistent app
  modal deploy modal_extract.py
"""

import modal
import os

# Create Modal app
app = modal.App("manual-extractor-cpu")

# CPU-based image (much cheaper than GPU)
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1-mesa-glx", "libglib2.0-0", "wget", "poppler-utils")
    .pip_install(
        "marker-pdf",
        "supabase",
        "python-dotenv",
        "requests",
    )
)

@app.function(
    image=image,
    cpu=2,  # Use 2 CPU cores per worker
    memory=4096,  # 4GB RAM
    timeout=3600,  # 60 minute timeout per PDF (CPU is slower)
    retries=2,  # Retry failed extractions
    secrets=[modal.Secret.from_name("supabase-secrets")],
)
def extract_single_manual(manual_data: dict) -> dict:
    """Extract a single manual using marker-pdf on Modal"""
    import subprocess
    import tempfile
    import requests
    from pathlib import Path
    from supabase import create_client

    manual_id = manual_data["id"]
    pdf_url = manual_data["pdf_url"]
    year = manual_data["year"]
    make = manual_data["make"]
    model = manual_data["model"]

    # Initialize Supabase
    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_KEY"]
    supabase = create_client(supabase_url, supabase_key)

    try:
        print(f"[START] {year} {make} {model} ({manual_id[:8]})")
        import time
        start_time = time.time()

        # Mark as extracting
        print(f"  [{manual_id[:8]}] Marking as extracting...")
        supabase.table("vehicle_manuals").update(
            {"content_status": "extracting"}
        ).eq("id", manual_id).execute()

        # Download PDF
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = Path(tmpdir) / "manual.pdf"
            output_dir = Path(tmpdir) / "output"
            output_dir.mkdir()

            # Download
            print(f"  [{manual_id[:8]}] Downloading PDF from {pdf_url[:50]}...")
            response = requests.get(pdf_url, timeout=300)
            response.raise_for_status()
            pdf_path.write_bytes(response.content)
            pdf_size = pdf_path.stat().st_size / 1024 / 1024
            print(f"  [{manual_id[:8]}] Downloaded {pdf_size:.1f} MB in {time.time() - start_time:.1f}s")

            # Run marker-pdf with real-time output
            print(f"  [{manual_id[:8]}] Starting marker-pdf extraction...")
            extract_start = time.time()
            import sys
            process = subprocess.Popen(
                [
                    "marker_single",
                    str(pdf_path),
                    "--output_dir", str(output_dir),
                    "--output_format", "markdown",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            # Stream output in real-time
            for line in process.stdout:
                line = line.strip()
                if line:
                    print(f"  [{manual_id[:8]}] {line}")
                    sys.stdout.flush()

            process.wait(timeout=1500)
            result_code = process.returncode
            print(f"  [{manual_id[:8]}] marker-pdf finished in {time.time() - extract_start:.1f}s (exit code: {result_code})")

            if result_code != 0:
                raise Exception(f"marker-pdf failed with exit code {result_code}")

            # Find the output markdown file
            print(f"  [{manual_id[:8]}] Looking for output markdown...")
            md_files = list(output_dir.rglob("*.md"))
            if not md_files:
                raise Exception("No markdown output generated")

            markdown_content = md_files[0].read_text()
            print(f"  [{manual_id[:8]}] Got {len(markdown_content):,} chars of markdown")

            if len(markdown_content) < 1000:
                raise Exception(f"Output too short: {len(markdown_content)} chars")

            # Parse sections from markdown
            sections = parse_sections(markdown_content)
            print(f"  [{manual_id[:8]}] Parsed {len(sections)} sections")

            # Upload to Supabase
            print(f"  [{manual_id[:8]}] Uploading to Supabase...")
            # First, delete any existing content
            supabase.table("manual_content").delete().eq("manual_id", manual_id).execute()
            supabase.table("manual_sections").delete().eq("manual_id", manual_id).execute()

            # Insert full content
            supabase.table("manual_content").insert({
                "manual_id": manual_id,
                "content_markdown": markdown_content,
                "total_char_count": len(markdown_content),
                "total_word_count": len(markdown_content.split()),
                "extraction_method": "marker-pdf-modal-cpu",
            }).execute()

            # Mark as extracted IMMEDIATELY after content is saved
            # This ensures we don't lose work if section insertion fails
            supabase.table("vehicle_manuals").update(
                {"content_status": "extracted"}
            ).eq("id", manual_id).execute()

            # Insert sections (non-critical - if this fails, content is still saved)
            try:
                for i, section in enumerate(sections):
                    supabase.table("manual_sections").insert({
                        "manual_id": manual_id,
                        "section_path": str(i + 1),  # Simple numeric path: "1", "2", "3"...
                        "section_title": section["title"],
                        "sort_order": i,
                        "depth": 1,
                        "content_markdown": section["content"],
                        "content_plain": section["content"],
                        "char_count": len(section["content"]),
                        "word_count": len(section["content"].split()),
                    }).execute()
                print(f"  [{manual_id[:8]}] Inserted {len(sections)} sections")
            except Exception as section_err:
                print(f"  [{manual_id[:8]}] Warning: Section insertion failed: {str(section_err)[:100]}")

            print(f"[DONE] {year} {make} {model} - {len(markdown_content):,} chars, {len(sections)} sections")

            return {
                "id": manual_id,
                "success": True,
                "name": f"{year} {make} {model}",
                "content_length": len(markdown_content),
                "sections": len(sections),
            }

    except Exception as e:
        # Mark as failed
        supabase.table("vehicle_manuals").update(
            {"content_status": "failed"}
        ).eq("id", manual_id).execute()

        print(f"[FAIL] {year} {make} {model} - {str(e)[:200]}")

        return {
            "id": manual_id,
            "success": False,
            "name": f"{year} {make} {model}",
            "error": str(e)[:500],
        }


def parse_sections(markdown: str) -> list:
    """Parse markdown into sections based on headers"""
    import re

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


@app.function(
    image=image,
    timeout=3600,
    secrets=[modal.Secret.from_name("supabase-secrets")],
)
def get_pending_manuals(limit: int = 100) -> list:
    """Get pending manuals from Supabase"""
    from supabase import create_client

    supabase_url = os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_KEY"]
    supabase = create_client(supabase_url, supabase_key)

    result = supabase.table("vehicle_manuals").select(
        "id, year, make, model, pdf_url"
    ).eq("content_status", "pending").limit(limit).execute()

    return result.data


@app.local_entrypoint()
def main(limit: int = 50):
    """Main entrypoint - fetch pending manuals and process them in parallel"""
    print(f"Fetching up to {limit} pending manuals...")

    manuals = get_pending_manuals.remote(limit)
    print(f"Found {len(manuals)} manuals to process")

    if not manuals:
        print("No pending manuals!")
        return

    # Process all manuals in parallel using Modal's map
    print(f"Starting parallel extraction with Modal...")
    results = list(extract_single_manual.map(manuals))

    # Summary
    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]

    print(f"\n{'='*50}")
    print(f"EXTRACTION COMPLETE")
    print(f"{'='*50}")
    print(f"  Successful: {len(successful)}")
    print(f"  Failed: {len(failed)}")

    if successful:
        print(f"\n  Successful extractions:")
        for r in successful[:10]:
            print(f"    - {r['name']}: {r['content_length']:,} chars, {r['sections']} sections")
        if len(successful) > 10:
            print(f"    ... and {len(successful) - 10} more")

    if failed:
        print(f"\n  Failed extractions:")
        for r in failed[:10]:
            print(f"    - {r['name']}: {r['error'][:100]}")
        if len(failed) > 10:
            print(f"    ... and {len(failed) - 10} more")
