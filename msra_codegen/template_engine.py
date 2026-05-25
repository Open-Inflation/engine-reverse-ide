from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    from jinja2 import Environment, FileSystemLoader, StrictUndefined
except ImportError as exc:  # pragma: no cover - helpful runtime error
    raise RuntimeError(
        "msra_codegen requires Jinja2. Install it with `pip install jinja2`."
    ) from exc


TEMPLATE_ROOT = Path(__file__).resolve().parent / "templates"
TEMPLATE_ENV = Environment(
    loader=FileSystemLoader(str(TEMPLATE_ROOT)),
    autoescape=False,
    trim_blocks=True,
    lstrip_blocks=True,
    keep_trailing_newline=True,
    undefined=StrictUndefined,
)


def render_template(name: str, context: dict[str, Any]) -> str:
    return TEMPLATE_ENV.get_template(name).render(**context)
