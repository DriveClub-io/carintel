"""
Docling PDF extraction on Modal cloud.

Runs Docling with GPU acceleration for fast, high-quality extraction.
Estimated cost: ~$20-30 for 3,200 manuals.

Usage:
    modal run modal_docling.py          # Test with 1 manual
    modal run modal_docling.py --limit 10  # Process 10 manuals
    modal run modal_docling.py --continuous  # Process all pending
"""

import modal
import os

# Create Modal app
app = modal.App("docling-extractor")

# Docker image with Docling and dependencies
docling_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install(
        # Required for OpenCV and image processing
        "libgl1-mesa-glx",
        "libglib2.0-0",
        "libsm6",
        "libxext6",
        "libxrender-dev",
        "libgomp1",
    )
    .pip_install(
        "docling>=2.0.0",
        "supabase",
        "requests",
        "python-dotenv",
        "onnxruntime-gpu",  # For GPU-accelerated OCR
    )
    .env({
        "OMP_NUM_THREADS": "4",
    })
)


@app.function(
    image=docling_image,
    gpu="A10G",  # Good balance of cost and performance
    timeout=1800,  # 30 min max per manual
    retries=1,
    secrets=[modal.Secret.from_name("supabase-secrets")],
)
def extract_manual(manual: dict) -> dict:
    """Extract a single manual using Docling with GPU acceleration."""
    import tempfile
    import time
    import requests
    from pathlib import Path
    from supabase import create_client

    manual_id = manual["id"]
    pdf_url = manual["pdf_url"]
    year = manual["year"]
    make = manual["make"]
    model = manual["model"]
    name = f"{year} {make} {model}"

    # Initialize Supabase
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"]
    )

    try:
        print(f"[START] {name}")
        start_time = time.time()

        # Mark as extracting
        supabase.table("vehicle_manuals").update(
            {"content_status": "extracting"}
        ).eq("id", manual_id).execute()

        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = Path(tmpdir) / "manual.pdf"

            # Download PDF
            print(f"  Downloading PDF...")
            response = requests.get(pdf_url, timeout=300)
            response.raise_for_status()
            pdf_path.write_bytes(response.content)
            pdf_size = pdf_path.stat().st_size / 1024 / 1024
            print(f"  Downloaded {pdf_size:.1f} MB")

            # Run Docling extraction
            print(f"  Running Docling extraction...")
            extract_start = time.time()

            from docling.document_converter import DocumentConverter

            converter = DocumentConverter()
            result = converter.convert(str(pdf_path))
            markdown_content = result.document.export_to_markdown()

            extract_time = time.time() - extract_start
            print(f"  Extraction completed in {extract_time:.1f}s")
            print(f"  Got {len(markdown_content):,} chars of markdown")

            if len(markdown_content) < 1000:
                raise Exception(f"Output too short: {len(markdown_content)} chars")

            # Parse sections
            sections = parse_sections(markdown_content)
            print(f"  Parsed {len(sections)} sections")

            # Upload to Supabase
            print(f"  Uploading to Supabase...")

            # Delete existing content
            supabase.table("manual_content").delete().eq("manual_id", manual_id).execute()
            supabase.table("manual_sections").delete().eq("manual_id", manual_id).execute()

            # Insert full content
            supabase.table("manual_content").insert({
                "manual_id": manual_id,
                "content_markdown": markdown_content,
                "total_char_count": len(markdown_content),
                "total_word_count": len(markdown_content.split()),
                "extraction_method": "docling-modal-gpu",
            }).execute()

            # Mark as extracted
            supabase.table("vehicle_manuals").update(
                {"content_status": "extracted"}
            ).eq("id", manual_id).execute()

            # Insert sections in batch (much faster than one-by-one)
            section_rows = []
            for i, section in enumerate(sections):
                if not section["content"].strip():
                    continue
                section_rows.append({
                    "manual_id": manual_id,
                    "section_path": str(i + 1),
                    "section_title": section["title"][:255],  # Truncate if too long
                    "sort_order": i,
                    "depth": 1,
                    "content_markdown": section["content"],
                    "content_plain": section["content"],
                    "char_count": len(section["content"]),
                    "word_count": len(section["content"].split()),
                })

            # Batch insert in chunks of 100 to avoid payload limits
            for chunk_start in range(0, len(section_rows), 100):
                chunk = section_rows[chunk_start:chunk_start + 100]
                try:
                    supabase.table("manual_sections").insert(chunk).execute()
                except Exception as e:
                    print(f"  Warning: Batch insert failed: {str(e)[:50]}")

            total_time = time.time() - start_time
            print(f"[DONE] {name} - {len(markdown_content):,} chars, {len(sections)} sections in {total_time:.1f}s")

            return {
                "success": True,
                "name": name,
                "chars": len(markdown_content),
                "sections": len(sections),
                "time": total_time,
            }

    except Exception as e:
        supabase.table("vehicle_manuals").update(
            {"content_status": "failed"}
        ).eq("id", manual_id).execute()

        print(f"[FAIL] {name} - {str(e)[:100]}")
        return {
            "success": False,
            "name": name,
            "error": str(e),
        }


def parse_sections(markdown: str) -> list:
    """Parse markdown into sections based on headers."""
    import re

    sections = []
    current_title = "Introduction"
    current_content = []

    for line in markdown.split("\n"):
        header_match = re.match(r"^(#{1,3})\s+(.+)$", line)
        if header_match:
            if current_content:
                sections.append({
                    "title": current_title,
                    "content": "\n".join(current_content).strip(),
                })
            current_title = header_match.group(2).strip()
            current_content = []
        else:
            current_content.append(line)

    if current_content:
        sections.append({
            "title": current_title,
            "content": "\n".join(current_content).strip(),
        })

    return sections


@app.function(
    image=docling_image,
    timeout=3600,
    secrets=[modal.Secret.from_name("supabase-secrets")],
)
def process_batch(limit: int = 10, continuous: bool = False) -> dict:
    """Process a batch of manuals."""
    from supabase import create_client

    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_KEY"]
    )

    total_success = 0
    total_failed = 0

    while True:
        # Get pending manuals
        pending = supabase.table("vehicle_manuals").select(
            "id, year, make, model, pdf_url"
        ).eq("content_status", "pending").limit(limit).execute()

        if not pending.data:
            print("No more pending manuals!")
            break

        print(f"\nProcessing batch of {len(pending.data)} manuals...")

        # Process in parallel using Modal's map
        results = list(extract_manual.map(pending.data))

        # Count results
        for r in results:
            if r.get("success"):
                total_success += 1
            else:
                total_failed += 1

        print(f"Batch complete: {sum(1 for r in results if r.get('success'))} success, {sum(1 for r in results if not r.get('success'))} failed")

        if not continuous:
            break

    return {
        "total_success": total_success,
        "total_failed": total_failed,
    }


@app.local_entrypoint()
def main(limit: int = 1, continuous: bool = False):
    """Main entry point."""
    import time

    print(f"Docling PDF Extraction on Modal")
    print(f"================================")
    print(f"Limit: {limit}")
    print(f"Continuous: {continuous}")

    start = time.time()

    if continuous:
        # Process all in batches
        result = process_batch.remote(limit=50, continuous=True)
    else:
        # Process limited batch
        result = process_batch.remote(limit=limit, continuous=False)

    elapsed = time.time() - start

    print(f"\n{'='*50}")
    print(f"COMPLETE")
    print(f"{'='*50}")
    print(f"Success: {result['total_success']}")
    print(f"Failed: {result['total_failed']}")
    print(f"Time: {elapsed:.1f}s")

    if result['total_success'] > 0:
        cost_estimate = (elapsed / 3600) * 0.60 * 1.5  # A10G ~$0.60/hr + overhead
        print(f"Estimated cost: ${cost_estimate:.2f}")
