from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable

from .generator_config import config_section


def get_python_line_length(default: int = 200) -> int:
    validation_config = config_section("validation")
    value = validation_config.get("line_length", default)
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("validation.line_length must be an integer.") from exc


def format_python_source(source: str, *, line_length: int | None = None) -> str:
    with tempfile.TemporaryDirectory(prefix="msra-python-format-") as tmp_dir:
        temp_path = Path(tmp_dir) / "snippet.py"
        temp_path.write_text(source, encoding="utf-8")
        format_python_files([temp_path], line_length=line_length)
        return temp_path.read_text(encoding="utf-8")


def format_python_files(paths: Iterable[Path], *, line_length: int | None = None) -> None:
    path_list = [Path(path).resolve() for path in paths]
    if not path_list:
        return

    effective_line_length = line_length if line_length is not None else get_python_line_length()
    file_args = [str(path) for path in path_list]
    run_python_tool(
        [
            "-m",
            "isort",
            "--profile",
            "black",
            "--line-length",
            str(effective_line_length),
            *file_args,
        ]
    )
    run_python_tool(
        [
            "-m",
            "black",
            "--line-length",
            str(effective_line_length),
            *file_args,
        ]
    )


def format_python_tree(root: Path, *, line_length: int | None = None) -> None:
    python_files = [
        path
        for path in root.rglob("*.py")
        if "__pycache__" not in path.parts and path.is_file()
    ]
    format_python_files(python_files, line_length=line_length)


def run_python_tool(arguments: list[str]) -> None:
    process = subprocess.run(
        [sys.executable, *arguments],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if process.returncode == 0:
        return

    stderr = process.stderr.strip()
    stdout = process.stdout.strip()
    details = stderr or stdout or "Python formatting command failed without output"
    raise RuntimeError(
        f"Formatting command failed with exit code {process.returncode}.\n"
        f"Command: {sys.executable} {' '.join(arguments)}\n"
        f"{details}"
    )
