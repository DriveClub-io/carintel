#!/usr/bin/env python3
"""
Test all PDF extraction methods on the same manual and compare quality.
"""

import os
import sys
import time
import tempfile
import requests
from pathlib import Path

# Get Supabase credentials
SUPABASE_URL = 'https://jxpbnnmefwtazfvoxvge.supabase.co'
env_file = Path('.env').read_text()
SUPABASE_KEY = env_file.split('SUPABASE_SERVICE_KEY=')[1].split('\n')[0].strip()

from supabase import create_client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Output directory
OUTPUT_DIR = Path("/tmp/extractor_comparison")
OUTPUT_DIR.mkdir(exist_ok=True)


def get_test_pdf():
    """Get a test PDF that we've already extracted with marker-pdf"""
    result = supabase.table('vehicle_manuals').select(
        'id, year, make, model, pdf_url'
    ).eq('content_status', 'extracted').limit(1).execute()

    if not result.data:
        print("No extracted manuals found!")
        sys.exit(1)

    manual = result.data[0]

    # Get existing marker content for comparison
    existing = supabase.table('manual_content').select('content_markdown').eq('manual_id', manual['id']).execute()
    marker_content = existing.data[0]['content_markdown'] if existing.data else ""

    return manual, marker_content


def download_pdf(url: str, dest: Path) -> int:
    """Download PDF and return page count"""
    print(f"Downloading PDF...")
    response = requests.get(url, timeout=300)
    dest.write_bytes(response.content)

    size_mb = dest.stat().st_size / 1024 / 1024
    print(f"Downloaded: {size_mb:.1f} MB")

    # Get page count
    try:
        import pymupdf
        doc = pymupdf.open(str(dest))
        pages = len(doc)
        doc.close()
        return pages
    except:
        return 0


def test_pymupdf4llm(pdf_path: Path) -> dict:
    """Test pymupdf4llm extraction"""
    print("\n" + "="*60)
    print("1. PYMUPDF4LLM")
    print("="*60)

    try:
        import pymupdf4llm

        start = time.time()
        content = pymupdf4llm.to_markdown(str(pdf_path))
        elapsed = time.time() - start

        output_path = OUTPUT_DIR / "pymupdf4llm.md"
        output_path.write_text(content)

        print(f"   Time: {elapsed:.1f}s")
        print(f"   Chars: {len(content):,}")
        print(f"   Saved: {output_path}")

        return {
            "name": "pymupdf4llm",
            "time": elapsed,
            "chars": len(content),
            "words": len(content.split()),
            "content": content,
            "success": True
        }
    except Exception as e:
        print(f"   ERROR: {e}")
        return {"name": "pymupdf4llm", "success": False, "error": str(e)}


def test_docling(pdf_path: Path) -> dict:
    """Test Docling extraction"""
    print("\n" + "="*60)
    print("2. DOCLING (IBM)")
    print("="*60)

    try:
        from docling.document_converter import DocumentConverter

        start = time.time()
        converter = DocumentConverter()
        result = converter.convert(str(pdf_path))
        content = result.document.export_to_markdown()
        elapsed = time.time() - start

        output_path = OUTPUT_DIR / "docling.md"
        output_path.write_text(content)

        print(f"   Time: {elapsed:.1f}s")
        print(f"   Chars: {len(content):,}")
        print(f"   Saved: {output_path}")

        return {
            "name": "docling",
            "time": elapsed,
            "chars": len(content),
            "words": len(content.split()),
            "content": content,
            "success": True
        }
    except Exception as e:
        print(f"   ERROR: {e}")
        return {"name": "docling", "success": False, "error": str(e)}


def test_mineru(pdf_path: Path) -> dict:
    """Test MinerU extraction"""
    print("\n" + "="*60)
    print("3. MINERU")
    print("="*60)

    try:
        from magic_pdf.data.data_reader_writer import FileBasedDataWriter, FileBasedDataReader
        from magic_pdf.model.doc_analyze_by_custom_model import doc_analyze
        from magic_pdf.pipe.OCRPipe import OCRPipe
        from magic_pdf.pipe.TXTPipe import TXTPipe
        from magic_pdf.pipe.UNIPipe import UNIPipe
        import magic_pdf.model as model_config

        start = time.time()

        # Read PDF
        pdf_bytes = pdf_path.read_bytes()

        # Setup output
        output_dir = OUTPUT_DIR / "mineru_output"
        output_dir.mkdir(exist_ok=True)

        image_writer = FileBasedDataWriter(str(output_dir / "images"))
        md_writer = FileBasedDataWriter(str(output_dir))

        # Analyze and extract
        model_config.local_parse = True
        model_list = doc_analyze(pdf_bytes, ocr=False)

        pipe = UNIPipe(pdf_bytes, model_list, image_writer)
        pipe.pipe_classify()
        pipe.pipe_analyze()
        pipe.pipe_parse()

        content = pipe.pipe_mk_markdown(str(output_dir / "images"), drop_mode="none")
        elapsed = time.time() - start

        output_path = OUTPUT_DIR / "mineru.md"
        output_path.write_text(content)

        print(f"   Time: {elapsed:.1f}s")
        print(f"   Chars: {len(content):,}")
        print(f"   Saved: {output_path}")

        return {
            "name": "mineru",
            "time": elapsed,
            "chars": len(content),
            "words": len(content.split()),
            "content": content,
            "success": True
        }
    except Exception as e:
        print(f"   ERROR: {e}")
        return {"name": "mineru", "success": False, "error": str(e)}


def test_marker_llm(pdf_path: Path) -> dict:
    """Test marker-pdf with LLM enhancement"""
    print("\n" + "="*60)
    print("4. MARKER-PDF + LLM")
    print("="*60)

    try:
        import subprocess

        output_dir = OUTPUT_DIR / "marker_llm_output"
        output_dir.mkdir(exist_ok=True)

        env = os.environ.copy()
        env["TORCH_DEVICE"] = "mps"

        start = time.time()

        # Check if we have an API key for LLM
        has_llm_key = os.environ.get('GOOGLE_API_KEY') or os.environ.get('OPENAI_API_KEY')

        cmd = [
            "marker_single",
            str(pdf_path),
            "--output_dir", str(output_dir),
            "--output_format", "markdown",
            "--disable_image_extraction",
        ]

        if has_llm_key:
            cmd.append("--use_llm")
            print("   Using LLM enhancement...")
        else:
            print("   No LLM API key found, running standard marker...")

        result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=1200)
        elapsed = time.time() - start

        # Find output
        md_files = list(output_dir.rglob("*.md"))
        if not md_files:
            raise Exception("No markdown output generated")

        content = md_files[0].read_text()

        output_path = OUTPUT_DIR / "marker_llm.md"
        output_path.write_text(content)

        print(f"   Time: {elapsed:.1f}s")
        print(f"   Chars: {len(content):,}")
        print(f"   Saved: {output_path}")

        return {
            "name": "marker-pdf" + (" + LLM" if has_llm_key else ""),
            "time": elapsed,
            "chars": len(content),
            "words": len(content.split()),
            "content": content,
            "success": True
        }
    except Exception as e:
        print(f"   ERROR: {e}")
        return {"name": "marker-pdf + LLM", "success": False, "error": str(e)}


def compare_results(results: list, marker_existing: str, pages: int):
    """Compare all extraction results"""
    print("\n" + "="*70)
    print("COMPARISON RESULTS")
    print("="*70)

    # Add existing marker result
    results.append({
        "name": "marker-pdf (existing)",
        "time": 0,
        "chars": len(marker_existing),
        "words": len(marker_existing.split()),
        "content": marker_existing,
        "success": True
    })

    print(f"\n{'Method':<25} {'Time':<10} {'Pages/sec':<12} {'Chars':<12} {'Words':<10}")
    print("-" * 70)

    for r in results:
        if not r.get("success"):
            print(f"{r['name']:<25} FAILED: {r.get('error', 'Unknown')[:40]}")
            continue

        pps = pages / r['time'] if r['time'] > 0 else float('inf')
        time_str = f"{r['time']:.1f}s" if r['time'] > 0 else "N/A"
        pps_str = f"{pps:.1f}" if r['time'] > 0 else "N/A"

        print(f"{r['name']:<25} {time_str:<10} {pps_str:<12} {r['chars']:,} {r['words']:,}")

    # Time estimates for 3200 manuals
    print("\n" + "="*70)
    print("TIME TO EXTRACT 3,200 MANUALS (400 pages avg)")
    print("="*70)

    for r in results:
        if not r.get("success") or r['time'] == 0:
            continue

        pps = pages / r['time']
        total_pages = 3200 * 400
        total_hours = total_pages / pps / 3600

        print(f"{r['name']:<25} ~{total_hours:.0f} hours ({total_hours/24:.1f} days)")

    # Quality samples
    print("\n" + "="*70)
    print("QUALITY SAMPLE: Lines 100-130 of each output")
    print("="*70)

    for r in results:
        if not r.get("success"):
            continue

        lines = r['content'].split('\n')
        sample = '\n'.join(lines[100:130]) if len(lines) > 130 else '\n'.join(lines[:30])

        print(f"\n--- {r['name']} ---")
        print(sample[:1000])


def main():
    print("PDF Extractor Comparison Test")
    print("="*70)

    # Get test PDF
    manual, marker_existing = get_test_pdf()
    name = f"{manual['year']} {manual['make']} {manual['model']}"
    print(f"\nTest Manual: {name}")

    with tempfile.TemporaryDirectory() as tmpdir:
        pdf_path = Path(tmpdir) / "test.pdf"
        pages = download_pdf(manual['pdf_url'], pdf_path)
        print(f"Pages: {pages}")

        results = []

        # Test each extractor
        results.append(test_pymupdf4llm(pdf_path))
        results.append(test_docling(pdf_path))
        results.append(test_mineru(pdf_path))
        results.append(test_marker_llm(pdf_path))

        # Compare
        compare_results(results, marker_existing, pages)

        print(f"\n\nAll outputs saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
