#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Script to load all PDF/DOCX files from data folder for RAG"""

import sys
import io
from pathlib import Path

# Fix encoding for Windows console
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

# Add parent directory to path to import api functions
sys.path.insert(0, str(Path(__file__).parent))

# Import after setting path
from api import load_rag_files_from_directory

def main():
    print("=" * 60)
    print("  RAG - Load files from data folder")
    print("=" * 60)
    print()
    
    # Use data folder in project root
    data_dir = Path(__file__).parent / "data"
    
    print(f"Folder: {data_dir}")
    print()
    
    if not data_dir.exists():
        print(f"[ERROR] Folder not found: {data_dir}")
        print(f"   Please create the 'data' folder and add your PDF/DOCX files.")
        return
    
    # Find all PDF and DOCX files
    pdf_files = list(data_dir.glob("*.pdf"))
    docx_files = list(data_dir.glob("*.docx"))
    all_files = pdf_files + docx_files
    
    if not all_files:
        print(f"[WARN] No PDF/DOCX files found in {data_dir}")
        print(f"   Please add PDF or DOCX files to the data folder.")
        return
    
    print(f"Found {len(all_files)} files:")
    for i, file_path in enumerate(all_files, 1):
        file_size = file_path.stat().st_size / (1024 * 1024)  # MB
        print(f"   {i}. {file_path.name} ({file_size:.2f} MB)")
    print()
    
    # Load files
    print("Processing files for RAG...")
    print()
    
    loaded_files = load_rag_files_from_directory(data_dir)
    
    # Print results
    print()
    print("=" * 60)
    print("  Results")
    print("=" * 60)
    
    loaded = [f for f in loaded_files if f.get("status") == "loaded"]
    already_loaded = [f for f in loaded_files if f.get("status") == "already_loaded"]
    errors = [f for f in loaded_files if f.get("status") == "error"]
    
    print(f"[OK] Newly loaded: {len(loaded)}")
    print(f"[INFO] Already loaded: {len(already_loaded)}")
    print(f"[ERROR] Errors: {len(errors)}")
    print()
    
    if loaded:
        print("Newly loaded files:")
        for f in loaded:
            chunks = f.get("chunks", 0)
            print(f"   [OK] {f['name']} -> {chunks} chunks")
        print()
    
    if already_loaded:
        print("Already loaded files (skipped):")
        for f in already_loaded:
            print(f"   [SKIP] {f['name']}")
        print()
    
    if errors:
        print("Files with errors:")
        for f in errors:
            print(f"   [ERROR] {f['name']}: {f.get('error', 'Unknown error')}")
        print()
    
    total_loaded = len(loaded) + len(already_loaded)
    if total_loaded > 0:
        print("=" * 60)
        print(f"[SUCCESS] {total_loaded} file(s) ready for RAG")
        print("=" * 60)
        print()
        print("You can now ask questions and the system will search")
        print("in all loaded files automatically!")
        print()
    else:
        print("=" * 60)
        print("[WARN] No files were loaded")
        print("=" * 60)

if __name__ == "__main__":
    main()

