"""
Convert Word documents (new AND old formats) to PDF via Word COM automation.

Windows-only (requires Microsoft Word + pywin32). Handles .docx and legacy .doc,
plus .docm/.rtf/.dot/.dotx. Recurses by default and mirrors the source folder
structure under `processed/`, so the tier/role folder layout your ingestion relies
on is preserved.
"""

import os
import win32com.client
import tkinter as tk
from tkinter import filedialog

# Word formats to convert. endswith() is checked case-insensitively, so .DOCX etc. are caught.
WORD_EXTENSIONS = (".doc", ".docx", ".docm", ".rtf", ".dot", ".dotx")
WD_FORMAT_PDF = 17          # wdFormatPDF
RECURSIVE = True            # set False to only convert the selected folder's top level
OUTPUT_DIRNAME = "processed"


def select_folder():
    root = tk.Tk()
    root.withdraw()  # Hide the root window
    return filedialog.askdirectory(title="Select a Folder")


def iter_word_files(folder_path, recursive):
    """Yield (dirpath, filename) for candidate files, skipping the output folder."""
    if recursive:
        for dirpath, dirnames, filenames in os.walk(folder_path):
            # Don't descend into the output folder (avoid reconverting our own PDFs' siblings).
            dirnames[:] = [d for d in dirnames if d.lower() != OUTPUT_DIRNAME]
            for name in filenames:
                yield dirpath, name
    else:
        for name in os.listdir(folder_path):
            if os.path.isfile(os.path.join(folder_path, name)):
                yield folder_path, name


def convert_word_to_pdf(folder_path):
    if not folder_path:
        print("No folder selected. Exiting.")
        return

    processed_root = os.path.join(folder_path, OUTPUT_DIRNAME)
    os.makedirs(processed_root, exist_ok=True)

    word = win32com.client.Dispatch("Word.Application")
    word.Visible = False        # Run Word in the background
    word.DisplayAlerts = 0      # Suppress dialogs that would hang an invisible Word

    converted = failed = skipped = 0
    try:
        for dirpath, file in iter_word_files(folder_path, RECURSIVE):
            lower = file.lower()
            # Ignore temp Word lock files (~$...) and anything that isn't a Word doc.
            if file.startswith("~$") or not lower.endswith(WORD_EXTENSIONS):
                continue

            src_path = os.path.normpath(os.path.abspath(os.path.join(dirpath, file)))

            # Mirror the source subfolder structure under processed/.
            rel_dir = os.path.relpath(dirpath, folder_path)
            out_dir = processed_root if rel_dir == "." else os.path.join(processed_root, rel_dir)
            os.makedirs(out_dir, exist_ok=True)

            base = os.path.splitext(file)[0]   # strip ANY extension, not just .docx
            pdf_path = os.path.normpath(os.path.join(out_dir, base + ".pdf"))

            if os.path.exists(pdf_path):
                print(f"Skipping (already converted): {pdf_path}")
                skipped += 1
                continue

            doc = None
            try:
                # ConfirmConversions=False stops legacy .doc files from popping a
                # "convert this document?" dialog that would otherwise hang the script.
                doc = word.Documents.Open(
                    src_path, ConfirmConversions=False, ReadOnly=True, AddToRecentFiles=False
                )
                doc.SaveAs(pdf_path, FileFormat=WD_FORMAT_PDF)
                print(f"Converted: {src_path} -> {pdf_path}")
                converted += 1
            except Exception as e:
                print(f"Failed to convert {src_path}: {e}")
                failed += 1
            finally:
                if doc is not None:
                    doc.Close(SaveChanges=False)  # always close, even if SaveAs failed
    finally:
        word.Quit()

    print(f"\nConversion complete! Converted: {converted}, Failed: {failed}, Skipped: {skipped}")


if __name__ == "__main__":
    convert_word_to_pdf(select_folder())
