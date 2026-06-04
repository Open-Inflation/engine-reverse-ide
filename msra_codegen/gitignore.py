from __future__ import annotations

from pathlib import Path
from typing import Any

from .file_utils import write_text
from .generator_config import config_section
from .template_engine import render_template


def build_gitignore_context() -> dict[str, Any]:
    gitignore_config = config_section("gitignore")
    patterns = gitignore_config.get("patterns")
    if not isinstance(patterns, list) or not patterns:
        raise RuntimeError("gitignore.patterns must be a non-empty list.")

    normalized_patterns: list[str] = []
    for index, pattern in enumerate(patterns):
        if not isinstance(pattern, str):
            raise TypeError(f"gitignore.patterns[{index}] must be a string.")
        normalized_patterns.append(pattern.rstrip())

    return {"patterns": normalized_patterns}


def generate_gitignore_project(output_dir: Path) -> None:
    context = build_gitignore_context()
    write_text(
        output_dir / ".gitignore",
        render_template("gitignore.tpl", context),
    )
