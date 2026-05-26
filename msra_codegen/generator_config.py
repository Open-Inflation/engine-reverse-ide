from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import tomllib


CONFIG_PATH = Path(__file__).with_name("config.toml")


@lru_cache(maxsize=1)
def load_generator_config() -> dict[str, Any]:
    with CONFIG_PATH.open("rb") as handle:
        data = tomllib.load(handle)
    return data if isinstance(data, dict) else {}


def config_section(*path: str) -> dict[str, Any]:
    current: Any = load_generator_config()
    for key in path:
        if not isinstance(current, dict):
            return {}
        current = current.get(key, {})
    return current if isinstance(current, dict) else {}


def config_value(*path: str, default: Any = None) -> Any:
    current: Any = load_generator_config()
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return default
        current = current[key]
    return current
