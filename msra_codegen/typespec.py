from __future__ import annotations

import re
from typing import Any

from .python_render import get_plain_value, regex_class_name, render_expr, render_simple_value


def should_render_setter(variable: dict[str, Any]) -> bool:
    if variable["name"] == "token":
        return False
    return not bool(variable.get("read_only", False))


def variable_type_names(variable: dict[str, Any]) -> set[str]:
    types = variable.get("types")
    if isinstance(types, dict):
        kind = types.get("kind")
        if kind == "array":
            result = set()
            for item in types.get("items", []):
                if isinstance(item, dict) and item.get("kind") == "inline_table":
                    item_dict = inline_table_to_dict(item)
                    type_name = item_dict.get("type")
                    if type_name:
                        result.add(str(type_name))
            return result
        if kind == "inline_table":
            item_dict = inline_table_to_dict(types)
            type_name = item_dict.get("type")
            return {str(type_name)} if type_name else set()
        type_name = types.get("type")
        return {str(type_name)} if type_name else set()
    if isinstance(types, list):
        result = set()
        for item in types:
            if isinstance(item, dict):
                type_name = item.get("type")
                if type_name:
                    result.add(str(type_name))
        return result
    if isinstance(types, str):
        return {types}
    return set()


def extract_variable_match(types_expr: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(types_expr, dict) or types_expr.get("kind") != "array":
        return None
    for item in types_expr.get("items", []):
        if not isinstance(item, dict) or item.get("kind") != "inline_table":
            continue
        for inline_item in item.get("items", []):
            if inline_item.get("key") == "match":
                return inline_item.get("value")
    return None


def type_annotation_from_types(type_names: set[str], *, nullable: bool = False) -> str:
    if not type_names:
        return "Any | None" if nullable else "Any"
    non_null = {name for name in type_names if name != "null"}
    base = {
        "string": "str",
        "integer": "int",
        "boolean": "bool",
        "number": "float",
        "array": "list[Any]",
        "object": "dict[str, Any]",
    }
    if not non_null:
        return "Any | None"
    annotation = base.get(next(iter(non_null)), "Any")
    if nullable or "null" in type_names:
        return f"{annotation} | None"
    return annotation


def type_annotation_from_expr(expr: dict[str, Any] | None) -> str:
    if is_list_type_expr(expr):
        item_expr = list_item_type_expr(expr)
        return f"list[{type_annotation_from_expr(item_expr)}]"
    if is_abstraction_reference_expr(expr):
        return "Any"
    type_names = type_names_from_expr(expr)
    return type_annotation_from_types(type_names)


def primary_type_name(type_names: set[str]) -> str | None:
    for candidate in ("integer", "number", "boolean", "string", "array", "object", "null"):
        if candidate in type_names:
            return candidate
    return None


def inline_array_to_list(expr: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not expr or expr.get("kind") != "array":
        return []
    result: list[dict[str, Any]] = []
    for item in expr.get("items", []):
        if item and item.get("kind") == "inline_table":
            result.append(inline_table_to_dict(item))
    return result


def inline_table_to_dict(expr: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"kind": expr.get("kind")}
    for item in expr.get("items", []):
        result[item["key"]] = get_plain_value(item["value"])
    return result


def escape_docstring(text: str) -> str:
    return text.replace('"""', '\\"\\"\\"')


def variable_match_pattern(variable: dict[str, Any]) -> str | None:
    match = variable.get("match")
    return match_to_pattern(match)


def match_to_values(expr: dict[str, Any] | None) -> list[Any] | None:
    if not expr or expr.get("kind") != "array":
        return None
    values: list[Any] = []
    for item in expr.get("items", []):
        value, ok = scalar_value_from_expr(item)
        if not ok:
            return None
        values.append(value)
    return values


def match_to_pattern(expr: dict[str, Any] | None) -> str | None:
    if not expr:
        return None
    if expr.get("kind") == "string":
        return render_simple_value(expr.get("value"))
    if expr.get("kind") == "ref":
        parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
        if len(parts) >= 3 and parts[0] == "DOCUMENT" and parts[1] == "REGEXES":
            return f"abstraction.{regex_class_name(parts[2])}.REGEX"
    return None


def match_to_error(expr: dict[str, Any] | None) -> str | None:
    if not expr or expr.get("kind") != "ref":
        return None
    parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
    if len(parts) >= 3 and parts[0] == "DOCUMENT" and parts[1] == "REGEXES":
        return f"abstraction.{regex_class_name(parts[2])}.ERROR"
    return None


def match_to_check_expr(expr: dict[str, Any] | None, value_expr: str) -> str | None:
    if not expr:
        return None
    if expr.get("kind") == "string":
        pattern = render_simple_value(expr.get("value"))
        return f"re.fullmatch({pattern}, str({value_expr})) is not None"
    if expr.get("kind") != "ref":
        return None
    parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
    if len(parts) >= 3 and parts[0] == "DOCUMENT" and parts[1] == "REGEXES":
        return f"abstraction.{regex_class_name(parts[2])}.match({value_expr})"
    return None


def match_to_range(expr: dict[str, Any] | None) -> tuple[int | float | None, int | float | None] | None:
    if not expr or expr.get("kind") != "inline_table":
        return None
    values = inline_table_to_dict(expr)
    has_lower = "from" in values
    has_upper = "to" in values
    if not has_lower and not has_upper:
        return None
    lower = values.get("from")
    upper = values.get("to")
    if has_lower and (isinstance(lower, bool) or not isinstance(lower, (int, float))):
        return None
    if has_upper and (isinstance(upper, bool) or not isinstance(upper, (int, float))):
        return None
    return (lower if has_lower else None, upper if has_upper else None)


def scalar_value_from_expr(expr: dict[str, Any] | None) -> tuple[Any, bool]:
    if not isinstance(expr, dict):
        return None, False
    kind = expr.get("kind")
    if kind == "string":
        return expr.get("value"), True
    if kind == "number":
        return expr.get("value"), True
    if kind == "bool":
        return bool(expr.get("value")), True
    if kind == "null":
        return None, True
    return None, False


def normalize_name(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def type_names_from_expr(expr: dict[str, Any] | None) -> set[str]:
    if is_list_type_expr(expr):
        item_expr = list_item_type_expr(expr)
        return type_names_from_expr(item_expr)
    plain = get_plain_value(expr)
    if isinstance(plain, str):
        return {plain}
    if isinstance(plain, list):
        result = set()
        for item in plain:
            if isinstance(item, dict) and item.get("type"):
                result.add(str(item["type"]))
        return result
    if isinstance(plain, dict) and plain.get("type"):
        return {str(plain["type"])}
    return set()


def is_list_type_expr(expr: dict[str, Any] | None) -> bool:
    if not isinstance(expr, dict) or expr.get("kind") != "sequence":
        return False
    items = expr.get("items", [])
    if len(items) != 2:
        return False
    if get_plain_value(items[0]) != "list":
        return False
    return isinstance(items[1], dict) and items[1].get("kind") == "array"


def list_item_type_expr(expr: dict[str, Any] | None) -> dict[str, Any] | None:
    if not is_list_type_expr(expr):
        return None
    items = expr.get("items", [])
    if len(items) != 2:
        return None
    inner = items[1]
    if not isinstance(inner, dict):
        return None
    inner_items = inner.get("items", [])
    if not inner_items:
        return None
    first = inner_items[0]
    return first if isinstance(first, dict) else None


def ref_input_name(expr: dict[str, Any] | None) -> str | None:
    if not isinstance(expr, dict) or expr.get("kind") != "ref":
        return None
    parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
    if len(parts) >= 2 and parts[0] == "INPUT":
        return parts[1]
    return None


def is_abstraction_reference_expr(expr: dict[str, Any] | None) -> bool:
    if not isinstance(expr, dict) or expr.get("kind") != "ref":
        return False
    parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
    return len(parts) >= 2 and parts[0] == "ABSTRACTIONS"


def selectable_values_from_plain_values(values: Any) -> list[Any]:
    if not isinstance(values, list):
        return []
    if all(not isinstance(item, dict) for item in values):
        return list(values)
    return [
        item["value"]
        for item in values
        if isinstance(item, dict) and item.get("value") is not None
    ]
