from pathlib import Path

from docx import Document


def preview_doc(path: Path, max_lines: int = 12) -> None:
    print(f"==== {path} ====")
    if not path.exists():
        print("  [ERR] File not found")
        return
    doc = Document(str(path))
    lines = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    for line in lines[:max_lines]:
        # Truncate for display only
        txt = line
        if len(txt) > 140:
            txt = txt[:137] + "..."
        print(" ", txt)
    print(f"--- total non-empty paragraphs: {len(lines)}\n")


if __name__ == "__main__":
    base = Path(r"C:\Users\ASUS\Downloads")
    preview_doc(base / "document.docx")
    preview_doc(base / "CV_P2_1292_12122025_Trienkhaimotsovanban_basic.docx")

