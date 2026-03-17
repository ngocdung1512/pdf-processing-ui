"""
OCR basic/testing pipeline (example utility, not used by the web app).
"""

# Keep original implementation in this file by importing the root script's functions if needed.
# This file is intentionally left as a thin wrapper to preserve behavior and avoid duplicating 700+ lines.

from pathlib import Path
import runpy


def main():
    # Execute the original root-level script as if it were run directly.
    root_script = Path(__file__).resolve().parent.parent / "ocr_basic.py"
    runpy.run_path(str(root_script), run_name="__main__")


if __name__ == "__main__":
    main()

