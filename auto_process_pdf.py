"""CLI entry — implementation in cli/auto_process_pdf.py (run from repo root)."""
import subprocess
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parent
if __name__ == "__main__":
    script = _REPO / "cli" / "auto_process_pdf.py"
    raise SystemExit(subprocess.call([sys.executable, str(script), *sys.argv[1:]], cwd=str(_REPO)))
