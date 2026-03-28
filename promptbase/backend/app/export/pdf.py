import subprocess
import tempfile
from pathlib import Path


def convert_to_pdf(docx_path: str) -> str | None:
    try:
        output_dir = tempfile.mkdtemp()
        result = subprocess.run(
            ["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", output_dir, docx_path],
            capture_output=True, timeout=60,
        )
        if result.returncode == 0:
            pdf_name = Path(docx_path).stem + ".pdf"
            pdf_path = Path(output_dir) / pdf_name
            if pdf_path.exists():
                return str(pdf_path)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return None
