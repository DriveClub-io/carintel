#!/usr/bin/env python3
"""
Benchmark different PDF extraction approaches.
Tests speed and quality on sample manuals.
"""

import os
import sys
import time
import tempfile
import subprocess
import requests
from pathlib import Path

# Test URL will be fetched from database
TEST_PDF_URL = None  # Set dynamically


def benchmark_marker(pdf_path: Path, output_dir: Path) -> dict:
    """Benchmark marker-pdf extraction"""
    start = time.time()

    env = os.environ.copy()
    env["TORCH_DEVICE"] = "mps"

    result = subprocess.run(
        [
            "marker_single",
            str(pdf_path),
            "--output_dir", str(output_dir / "marker"),
            "--output_format", "markdown",
            "--disable_image_extraction",
        ],
        capture_output=True,
        text=True,
        env=env,
    )

    elapsed = time.time() - start

    # Find output
    md_files = list((output_dir / "marker").rglob("*.md"))
    content = md_files[0].read_text() if md_files else ""

    return {
        "method": "marker-pdf (GPU)",
        "time": elapsed,
        "chars": len(content),
        "success": result.returncode == 0,
    }


def benchmark_pymupdf(pdf_path: Path, output_dir: Path) -> dict:
    """Benchmark pymupdf4llm extraction"""
    try:
        import pymupdf4llm
    except ImportError:
        return {"method": "pymupdf4llm", "error": "Not installed. Run: pip install pymupdf4llm"}

    start = time.time()
    content = pymupdf4llm.to_markdown(str(pdf_path))
    elapsed = time.time() - start

    # Save output
    (output_dir / "pymupdf.md").write_text(content)

    return {
        "method": "pymupdf4llm",
        "time": elapsed,
        "chars": len(content),
        "success": True,
    }


def benchmark_pymupdf_basic(pdf_path: Path, output_dir: Path) -> dict:
    """Benchmark basic pymupdf text extraction (fastest but lowest quality)"""
    try:
        import pymupdf
    except ImportError:
        return {"method": "pymupdf (basic)", "error": "Not installed. Run: pip install pymupdf"}

    start = time.time()
    doc = pymupdf.open(str(pdf_path))
    content = ""
    for page in doc:
        content += page.get_text() + "\n\n"
    doc.close()
    elapsed = time.time() - start

    (output_dir / "pymupdf_basic.txt").write_text(content)

    return {
        "method": "pymupdf (basic text)",
        "time": elapsed,
        "chars": len(content),
        "success": True,
    }


def count_pages(pdf_path: Path) -> int:
    """Count pages in PDF"""
    try:
        import pymupdf
        doc = pymupdf.open(str(pdf_path))
        pages = len(doc)
        doc.close()
        return pages
    except:
        return 0


def get_test_pdf_url():
    """Get a test PDF URL from database"""
    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv()
    supabase = create_client(
        os.getenv('SUPABASE_URL', 'https://jxpbnnmefwtazfvoxvge.supabase.co'),
        os.getenv('SUPABASE_SERVICE_KEY')
    )

    # Get a pending manual (skip Alfa Romeo which has issues)
    result = supabase.table('vehicle_manuals').select(
        'id, year, make, model, pdf_url'
    ).eq('content_status', 'pending').neq('make', 'Alfa Romeo').limit(1).execute()

    if result.data:
        m = result.data[0]
        return {
            "name": f"{m['year']} {m['make']} {m['model']}",
            "url": m['pdf_url']
        }
    return None


def main():
    print("PDF Extraction Benchmark")
    print("=" * 70)

    # Download test PDF
    test_pdf = get_test_pdf_url()
    if not test_pdf:
        print("No test PDF found!")
        return
    print(f"\nDownloading test PDF: {test_pdf['name']}")

    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        pdf_path = tmpdir / "test.pdf"
        output_dir = tmpdir / "output"
        output_dir.mkdir()

        response = requests.get(test_pdf["url"], timeout=120)
        pdf_path.write_bytes(response.content)

        pdf_size = pdf_path.stat().st_size / 1024 / 1024
        pages = count_pages(pdf_path)
        print(f"Downloaded: {pdf_size:.1f} MB, {pages} pages")

        results = []

        # Test basic pymupdf first (fastest)
        print("\n1. Testing pymupdf (basic text)...")
        result = benchmark_pymupdf_basic(pdf_path, output_dir)
        results.append(result)
        if "error" not in result:
            print(f"   {result['time']:.1f}s ({pages/result['time']:.1f} pages/sec)")

        # Test pymupdf4llm
        print("\n2. Testing pymupdf4llm (markdown)...")
        result = benchmark_pymupdf(pdf_path, output_dir)
        results.append(result)
        if "error" not in result:
            print(f"   {result['time']:.1f}s ({pages/result['time']:.1f} pages/sec)")
        else:
            print(f"   {result['error']}")

        # Test marker-pdf
        print("\n3. Testing marker-pdf (GPU)...")
        result = benchmark_marker(pdf_path, output_dir)
        results.append(result)
        if "error" not in result:
            print(f"   {result['time']:.1f}s ({pages/result['time']:.1f} pages/sec)")

        # Summary
        print("\n" + "=" * 70)
        print("RESULTS SUMMARY")
        print("=" * 70)
        print(f"{'Method':<25} {'Time':<10} {'Pages/sec':<12} {'Chars':<12}")
        print("-" * 70)

        for r in results:
            if "error" in r:
                print(f"{r['method']:<25} {r['error']}")
            else:
                pps = pages / r['time'] if r['time'] > 0 else 0
                print(f"{r['method']:<25} {r['time']:<10.1f} {pps:<12.1f} {r['chars']:,}")

        print("\n" + "=" * 70)
        print("TIME TO EXTRACT 3,200 MANUALS (estimated)")
        print("=" * 70)
        avg_pages = 400  # Typical owner's manual

        for r in results:
            if "error" in r:
                continue
            pps = pages / r['time'] if r['time'] > 0 else 0
            if pps > 0:
                total_pages = 3200 * avg_pages
                total_hours = total_pages / pps / 3600
                print(f"{r['method']:<25} ~{total_hours:.0f} hours ({total_hours/24:.1f} days)")

        # Quality comparison
        print("\n" + "=" * 70)
        print("QUALITY COMPARISON (first 500 chars of output)")
        print("=" * 70)

        for file in output_dir.glob("*"):
            if file.suffix in [".md", ".txt"]:
                print(f"\n--- {file.name} ---")
                content = file.read_text()[:500]
                print(content)


if __name__ == "__main__":
    main()
