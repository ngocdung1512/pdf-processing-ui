"""
OCR basic/testing pipeline (example utility, not used by the web app).
Delegates to repo-root ocr_basic.py so a single implementation is maintained.
"""

import subprocess
import sys
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent.parent
    script = root / "ocr_basic.py"
    raise SystemExit(
        subprocess.call([sys.executable, str(script)] + sys.argv[1:], cwd=str(root))
    )


if __name__ == "__main__":
    main()
