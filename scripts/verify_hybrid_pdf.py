"""Verify hybrid chatbot: upload PDF + one chat. Usage: python -u scripts/verify_hybrid_pdf.py [path.pdf]"""
import json
import os
import sys
import time

import requests

BASE = os.environ.get("HYBRID_TEST_BASE", "http://127.0.0.1:8010")


def wait_until_ready_for_upload(max_wait_sec: int = 900) -> bool:
    """Poll /ready until no active ingest (so upload is not blocked by another job)."""
    deadline = time.time() + max_wait_sec
    while time.time() < deadline:
        try:
            r = requests.get(f"{BASE}/ready", timeout=20)
            j = r.json() if r.ok else {}
            if r.ok and j.get("ready") is True and j.get("active_ingest_jobs", 0) == 0:
                return True
            print(
                f"... waiting idle (ready={j.get('ready')}, jobs={j.get('active_ingest_jobs')})",
                flush=True,
            )
        except Exception as e:
            print("... wait poll error:", e, flush=True)
        time.sleep(3)
    return False


def load_hf_token_env():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    envp = os.path.join(root, "scripts", "startup", "hf-token.env")
    if os.path.isfile(envp):
        for line in open(envp, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ[k.strip()] = v.strip()


def main():
    load_hf_token_env()
    pdf = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.path.join(os.environ.get("USERPROFILE", ""), "Desktop", "KH DÂN VẬN.pdf")
    )
    if not os.path.isfile(pdf):
        print("ERROR: PDF not found:", pdf, flush=True)
        sys.exit(2)

    t0 = time.time()
    print("=== wait until idle (no ingest) ===", flush=True)
    if not wait_until_ready_for_upload(900):
        print("ERROR: server did not become idle in time.", flush=True)
        sys.exit(3)

    print("=== GET /ready (before upload) ===", flush=True)
    r = requests.get(f"{BASE}/ready", timeout=30)
    print(r.status_code, r.text[:300], flush=True)

    print("=== POST /documents/upload ===", flush=True)
    with open(pdf, "rb") as f:
        up = requests.post(
            f"{BASE}/documents/upload",
            files={"file": (os.path.basename(pdf), f, "application/pdf")},
            timeout=1800,
        )
    print("upload", up.status_code, "sec", round(time.time() - t0, 1), flush=True)
    if up.status_code != 200:
        print(up.text[:1500], flush=True)
        sys.exit(1)
    doc_id = up.json().get("doc_id")
    print("doc_id", doc_id, flush=True)

    print("=== POST /chat ===", flush=True)
    t1 = time.time()
    chat = requests.post(
        f"{BASE}/chat",
        json={
            "message": "Nêu ngắn gọn tên tài liệu và số ký hiệu (nếu có) trong file.",
            "session_id": "verify-hybrid",
            "doc_ids": [doc_id],
        },
        timeout=600,
    )
    print("chat", chat.status_code, "sec", round(time.time() - t1, 1), flush=True)
    if chat.status_code != 200:
        print(chat.text[:1500], flush=True)
        sys.exit(1)
    body = chat.json()
    resp = body.get("response") or ""
    print("route", body.get("route"), flush=True)
    sys.stdout.buffer.write(
        ("response_prefix " + (resp[:800] if resp else "") + "\n").encode("utf-8", "replace")
    )
    sys.stdout.buffer.flush()
    if "Chưa có tài liệu" in resp:
        print("FAIL: chat_tool returned no-doc message", flush=True)
        sys.exit(1)
    print("=== OK total", round(time.time() - t0, 1), "s ===", flush=True)


if __name__ == "__main__":
    main()
