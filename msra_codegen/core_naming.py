from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .python_render import get_plain_value


def snake_case(text: str) -> str:
    text = re.sub(r"(?<!^)(?=[A-Z])", "_", text).replace("-", "_")
    text = re.sub(r"[^A-Za-z0-9_]+", "_", text)
    return text.strip("_").lower() or "generated"


def pascal_case(text: str) -> str:
    parts = re.split(r"[^A-Za-z0-9]+|_", text)
    cleaned = []
    for part in parts:
        if not part:
            continue
        cleaned.append(part[:1].upper() + part[1:].lower())
    return "".join(cleaned) or "Generated"


def root_client_class_name(project: dict[str, Any]) -> str:
    name = str(project["app"]["name"])
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
        return name
    return pascal_case(name)


def module_file_name_for_group(path: list[str]) -> str:
    if not path:
        return "generated.py"
    return f"{snake_case(path[-1])}.py"


def package_dir_for_group(path: list[str]) -> Path:
    return Path(*[snake_case(segment) for segment in path]) if path else Path()


def module_import_name_for_group(group_node: dict[str, Any]) -> str:
    path = group_node.get("path", [])
    if not path:
        return "generated"
    if group_node.get("children"):
        return snake_case(path[-1])
    return module_file_name_for_group(path)[:-3]


def module_package_depth_for_group(group_node: dict[str, Any]) -> int:
    path = group_node.get("path", [])
    return len(path) + (1 if group_node.get("children") else 0)


def module_output_dir_for_group(group_node: dict[str, Any], endpoints_root: Path) -> Path:
    path = group_node.get("path", [])
    if group_node.get("children"):
        return endpoints_root / package_dir_for_group(path)
    if path:
        return endpoints_root / package_dir_for_group(path[:-1])
    return endpoints_root


def base_class_name_for_group(path: list[str]) -> str:
    if not path:
        return "GeneratedGroup"
    return pascal_case(path[-1])


def class_name_for_group(path: list[str]) -> str:
    return f"Class{base_class_name_for_group(path)}"


def field_name_for_group(path: list[str]) -> str:
    if not path:
        return "Group"
    return str(path[-1])


def group_public_import_path(package_name: str, group_path: list[str]) -> str:
    segments = [snake_case(segment) for segment in group_path]
    if not segments:
        return f"{package_name}.endpoints"
    return ".".join([package_name, "endpoints", *segments])


def group_path_from_expr(expr: Any) -> str:
    plain = get_plain_value(expr)
    if isinstance(plain, dict) and plain.get("kind") == "ref":
        parts = [part["value"] for part in plain.get("parts", []) if part.get("kind") == "name"]
        if not parts:
            return ""
        if parts[0] == "GROUPS":
            parts = parts[1:]
        return ".".join(parts)
    if isinstance(plain, str):
        return plain.strip()
    if isinstance(plain, list):
        return ".".join(str(part).strip() for part in plain if str(part).strip())
    return str(plain).strip() if plain is not None else ""


def script_module_name_from_path(script_path: str) -> str:
    normalized = script_path.strip().replace("\\", "/")
    while normalized.startswith("./"):
        normalized = normalized[2:]
    if normalized.endswith(".py"):
        normalized = normalized[:-3]
    normalized = normalized.strip("/")
    return normalized.replace("/", ".") or "warmup"


def parse_script_reference(expr: Any) -> dict[str, str] | None:
    plain = get_plain_value(expr)
    if not isinstance(plain, str):
        return None
    script_path, separator, function_name = plain.rpartition(":")
    if not separator:
        return None
    script_path = script_path.strip()
    function_name = function_name.strip()
    if not script_path or not function_name:
        return None
    return {
        "path": script_path,
        "module": script_module_name_from_path(script_path),
        "function": function_name,
    }
