"""
Convert PDF scan to Word (Docx) using YOLO + Surya OCR
Replaces the old Marker-based approach with the new YOLO + Surya OCR pipeline
"""
import os
import sys
import argparse
import time
from pathlib import Path

# Ensure project root is on path and is cwd so process_pdf_to_docx and its imports (doclayout_yolo, etc.) resolve
_project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_project_root))
try:
    os.chdir(_project_root)
except Exception:
    pass

try:
    import fitz  # PyMuPDF for page count
except ImportError:
    fitz = None

_import_error = None
try:
    from process_pdf_to_docx import process_pdf_to_docx
    PROCESS_AVAILABLE = True
except ImportError as e:
    PROCESS_AVAILABLE = False
    _import_error = e

def main():
    parser = argparse.ArgumentParser(description="Convert scanned PDF to DOCX using YOLO + Surya OCR")
    parser.add_argument("pdf_file", help="Path to PDF file")
    parser.add_argument("--output", "-o", help="Output DOCX path", default=None)
    parser.add_argument("--max-pages", type=int, help="Maximum pages to process", default=None)
    parser.add_argument("--dpi", type=int, default=200, help="DPI for PDF to image conversion (default: 200)")
    
    args = parser.parse_args()
    
    pdf_path = Path(args.pdf_file)
    if not pdf_path.exists():
        print(f"Error: PDF file not found: {pdf_path}")
        sys.exit(1)
    
    if not PROCESS_AVAILABLE:
        print("Error: process_pdf_to_docx module not available.")
        print(f"  Import error: {_import_error}")
        print("  Tip: In conversion_env run: pip install -e DocLayout-YOLO and install requirements_win.txt")
        sys.exit(1)
    
    # Get page count if PyMuPDF available
    if fitz:
        doc = fitz.open(str(pdf_path))
        total_pages = len(doc)
        doc.close()
        print(f"PDF has {total_pages} pages")
    
    print("=" * 60)
    print("PDF to DOCX Converter (YOLO + Surya OCR)")
    print("=" * 60)
    print(f"Input: {pdf_path}")
    if args.output:
        print(f"Output: {args.output}")
    print()
    
    start_time = time.time()
    
    output_path = process_pdf_to_docx(
        str(pdf_path),
        args.output,
        max_pages=args.max_pages,
        dpi=args.dpi,
        enable_ocr=True,
    )
    
    elapsed = time.time() - start_time
    
    if output_path:
        print(f"\n✓ Conversion complete in {elapsed:.1f}s")
        print(f"  Output: {output_path}")
    else:
        print("\n✗ Conversion failed")
        sys.exit(1)

if __name__ == "__main__":
    main()
