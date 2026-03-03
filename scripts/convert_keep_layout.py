import argparse
import sys
from pathlib import Path
from pdf2docx import Converter

try:
    import fitz  # PyMuPDF for page count (for API progress)
except ImportError:
    fitz = None

def main():
    parser = argparse.ArgumentParser(description="Convert PDF to Word (Docx) preserving layout using pdf2docx.")
    parser.add_argument("pdf_file", help="Path to the PDF file to convert")
    parser.add_argument("--output", help="Optional output docx path", default=None)
    
    args = parser.parse_args()
    
    pdf_path = Path(args.pdf_file)
    if not pdf_path.exists():
        print(f"Error: PDF file not found: {pdf_path}")
        sys.exit(1)
    
    if args.output:
        output_path = Path(args.output)
    else:
        output_path = pdf_path.parent / f"{pdf_path.stem}.docx"
    
    # For API progress parsing (backend expects these patterns)
    if fitz:
        try:
            doc = fitz.open(str(pdf_path))
            total_pages = len(doc)
            doc.close()
            print(f"--- PDF Info: {total_pages} pages ---", flush=True)
        except Exception:
            pass
    print("--- Starting Layout-Preserving Conversion ---", flush=True)
    
    print("=" * 60)
    print("PDF to DOCX Converter (pdf2docx)")
    print("=" * 60)
    print(f"Input: {pdf_path}")
    print(f"Output: {output_path}")
    print()
    
    try:
        print("Converting...")
        cv = Converter(str(pdf_path))
        cv.convert(str(output_path))
        cv.close()
        print(f"✓ Conversion complete: {output_path}")
    except Exception as e:
        print(f"✗ Error during conversion: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
