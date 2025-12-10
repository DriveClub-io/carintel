#!/usr/bin/env python3
"""
Local PDF extraction using marker-pdf.

Runs on your local machine instead of Modal cloud.
Much slower but free (no cloud costs).

Usage:
  python local_extract.py              # Extract 1 manual
  python local_extract.py --limit 10   # Extract up to 10 manuals
  python local_extract.py --continuous # Keep running until all done
"""

import os
import re
import sys
import time
import argparse
import subprocess
import tempfile
import requests
from pathlib import Path
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


def extract_manual(manual: dict) -> dict:
    """Extract a single manual using marker-pdf locally"""
    manual_id = manual["id"]
    pdf_url = manual["pdf_url"]
    year = manual["year"]
    make = manual["make"]
    model = manual["model"]
    name = f"{year} {make} {model}"

    try:
        print(f"\n[START] {name}")
        start_time = time.time()

        # Mark as extracting
        supabase.table("vehicle_manuals").update(
            {"content_status": "extracting"}
        ).eq("id", manual_id).execute()

        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = Path(tmpdir) / "manual.pdf"
            output_dir = Path(tmpdir) / "output"
            output_dir.mkdir()

            # Download PDF
            print(f"  Downloading PDF...")
            response = requests.get(pdf_url, timeout=300)
            response.raise_for_status()
            pdf_path.write_bytes(response.content)
            pdf_size = pdf_path.stat().st_size / 1024 / 1024
            print(f"  Downloaded {pdf_size:.1f} MB")

            # Run marker-pdf with 20 minute timeout
            print(f"  Running marker-pdf extraction (20 min timeout)...")
            extract_start = time.time()
            timeout_seconds = 1200  # 20 minutes

            # Set environment with GPU acceleration
            env = os.environ.copy()
            env["TORCH_DEVICE"] = "mps"  # Use Metal GPU on Mac

            process = subprocess.Popen(
                [
                    "marker_single",
                    str(pdf_path),
                    "--output_dir", str(output_dir),
                    "--output_format", "markdown",
                    "--disable_image_extraction",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=env,
            )

            # Stream output with timeout check
            import select
            while True:
                # Check if process has finished
                if process.poll() is not None:
                    break

                # Check timeout
                elapsed = time.time() - extract_start
                if elapsed > timeout_seconds:
                    process.kill()
                    raise Exception(f"Timeout after {elapsed/60:.1f} minutes")

                # Read output if available (non-blocking)
                ready, _, _ = select.select([process.stdout], [], [], 1.0)
                if ready:
                    line = process.stdout.readline()
                    if line:
                        line = line.strip()
                        if line and ("%" in line or "page" in line.lower() or "Recognizing" in line):
                            print(f"  {line[:80]}")
                            sys.stdout.flush()

            if process.returncode != 0:
                raise Exception(f"marker-pdf failed with exit code {process.returncode}")

            extract_time = time.time() - extract_start
            print(f"  Extraction completed in {extract_time:.1f}s")

            # Find output markdown
            md_files = list(output_dir.rglob("*.md"))
            if not md_files:
                raise Exception("No markdown output generated")

            markdown_content = md_files[0].read_text()
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
                "extraction_method": "marker-pdf-local",
            }).execute()

            # Mark as extracted
            supabase.table("vehicle_manuals").update(
                {"content_status": "extracted"}
            ).eq("id", manual_id).execute()

            # Insert sections
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
                except Exception as e:
                    print(f"  Warning: Section {i} failed: {str(e)[:50]}")

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


def main():
    parser = argparse.ArgumentParser(description="Local PDF extraction")
    parser.add_argument("--limit", type=int, default=1, help="Number of manuals to extract")
    parser.add_argument("--continuous", action="store_true", help="Keep running until done")
    args = parser.parse_args()

    # Check if marker_single is available
    try:
        subprocess.run(["marker_single", "--help"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("ERROR: marker_single not found. Install with: pip install marker-pdf")
        return

    # Random offset to avoid race conditions between instances
    import random

    while True:
        # Get a random pending manual to avoid collisions between instances
        # First get count, then pick random offset
        count_result = supabase.table("vehicle_manuals").select(
            "id", count="exact"
        ).eq("content_status", "pending").execute()

        total_pending = count_result.count or 0
        if total_pending == 0:
            print("\nNo pending manuals!")
            break

        offset = random.randint(0, max(0, total_pending - 1))

        pending = supabase.table("vehicle_manuals").select(
            "id, year, make, model, pdf_url"
        ).eq("content_status", "pending").range(offset, offset).execute()

        # If no results at offset, try from beginning
        if not pending.data:
            pending = supabase.table("vehicle_manuals").select(
                "id, year, make, model, pdf_url"
            ).eq("content_status", "pending").limit(args.limit).execute()

        if not pending.data:
            print("\nNo pending manuals!")
            break

        print(f"\nFound {len(pending.data)} pending manuals")

        results = []
        for manual in pending.data:
            result = extract_manual(manual)
            results.append(result)

        # Summary
        successful = [r for r in results if r["success"]]
        failed = [r for r in results if not r["success"]]

        print(f"\n{'='*50}")
        print(f"Batch complete: {len(successful)} success, {len(failed)} failed")

        if not args.continuous:
            break

        # Small delay before next batch
        time.sleep(2)


if __name__ == "__main__":
    main()
