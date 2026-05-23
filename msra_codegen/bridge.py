from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


PACKAGE_ROOT = Path(__file__).resolve().parent
NODE_EXPORT = PACKAGE_ROOT / "node_export.js"


def load_msra_document(msra_path: Path) -> dict[str, Any]:
    msra_path = msra_path.resolve()
    if not msra_path.exists():
        raise FileNotFoundError(msra_path)

    process = subprocess.run(
        ["node", str(NODE_EXPORT), str(msra_path)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if process.returncode != 0:
        message = process.stderr.strip() or process.stdout.strip() or "MSRA parser failed"
        raise RuntimeError(message)
    return json.loads(process.stdout)
