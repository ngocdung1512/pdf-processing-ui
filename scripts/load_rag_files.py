#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Script to load RAG files from directory"""

import sys
from pathlib import Path

# Add parent directory to path to import api functions
sys.path.insert(0, str(Path(__file__).parent))

from api import load_rag_files_from_directory, RAG_FILES_DIR

def main():
    print("=== Loading RAG Files ===\n")
    
    # Use default directory or specify custom path
    if len(sys.argv) > 1:
        directory = Path(sys.argv[1])
        print(f"Loading files from: {directory}")
    else:
        directory = RAG_FILES_DIR
        print(f"Loading files from default directory: {directory}")
    
    if not directory.exists():
        print(f"\n[ERROR] Directory not found: {directory}")
        print(f"Please create the directory and add your PDF/DOCX files.")
        return
    
    # Load files
    loaded_files = load_rag_files_from_directory(directory)
    
    # Print results
    print(f"\n=== Results ===")
    print(f"Total files found: {len(loaded_files)}")
    
    loaded = [f for f in loaded_files if f.get("status") == "loaded"]
    already_loaded = [f for f in loaded_files if f.get("status") == "already_loaded"]
    errors = [f for f in loaded_files if f.get("status") == "error"]
    
    print(f"  - Newly loaded: {len(loaded)}")
    print(f"  - Already loaded: {len(already_loaded)}")
    print(f"  - Errors: {len(errors)}")
    
    if loaded:
        print(f"\nNewly loaded files:")
        for f in loaded:
            print(f"  ✓ {f['name']} ({f.get('chunks', 0)} chunks)")
    
    if errors:
        print(f"\nFiles with errors:")
        for f in errors:
            print(f"  ✗ {f['name']}: {f.get('error', 'Unknown error')}")
    
    print(f"\n[OK] RAG files loaded. You can now ask questions!")

if __name__ == "__main__":
    main()

