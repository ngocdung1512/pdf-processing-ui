import argparse
import os
from pathlib import Path
from process_pdf_to_docx import process_pdf_to_docx

def process_directory(input_dir: str, output_dir: str = None, model_path: str = "doclayout_yolo_docstructbench_imgsz1024.pt", imgsz: int = 1024, conf: float = 0.1, dpi: int = 300, enable_ocr: bool = True, max_pages: int = None):
    input_path = Path(input_dir)
    if not input_path.exists() or not input_path.is_dir():
        print(f"Error: Input directory not found: {input_dir}")
        return

    if output_dir is None:
        output_dir = input_path.parent / f"{input_path.name}_out"
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)

    pdf_files = list(input_path.glob("*.pdf"))
    if not pdf_files:
        print(f"No PDF files found in {input_dir}")
        return

    print(f"Found {len(pdf_files)} PDF files in {input_dir}")
    print(f"Output directory: {output_path}")
    print("=" * 80)

    success_count = 0
    for i, pdf_file in enumerate(pdf_files, 1):
        print(f"\nProcessing file {i}/{len(pdf_files)}: {pdf_file.name}")
        output_docx = output_path / f"{pdf_file.stem}_reconstructed.docx"
        
        try:
            result = process_pdf_to_docx(
                pdf_path=str(pdf_file),
                output_docx=str(output_docx),
                model_path=model_path,
                imgsz=imgsz,
                conf=conf,
                dpi=dpi,
                enable_ocr=enable_ocr,
                max_pages=max_pages
            )
            if result:
                success_count += 1
        except Exception as e:
            print(f"Error processing {pdf_file.name}: {e}")

    print("\n" + "=" * 80)
    print("BATCH PROCESSING COMPLETE")
    print("=" * 80)
    print(f"Successfully processed {success_count}/{len(pdf_files)} files")
    print(f"Outputs saved to: {output_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Batch process PDF files in a directory to DOCX')
    parser.add_argument('input_dir', type=str, help='Path to directory containing PDF files')
    parser.add_argument('--output_dir', type=str, default=None, help='Output directory for DOCX files')
    parser.add_argument('--model', type=str, default='doclayout_yolo_docstructbench_imgsz1024.pt', help='Path to YOLO model file')
    parser.add_argument('--imgsz', type=int, default=1024, help='Image size for inference')
    parser.add_argument('--conf', type=float, default=0.1, help='Confidence threshold')
    parser.add_argument('--dpi', type=int, default=300, help='DPI for PDF conversion')
    parser.add_argument('--no-ocr', action='store_true', help='Disable OCR')
    parser.add_argument('--max-pages', type=int, default=None, help='Maximum pages to process per file')
    
    args = parser.parse_args()
    
    process_directory(
        input_dir=args.input_dir,
        output_dir=args.output_dir,
        model_path=args.model,
        imgsz=args.imgsz,
        conf=args.conf,
        dpi=args.dpi,
        enable_ocr=not args.no_ocr,
        max_pages=args.max_pages
    )
