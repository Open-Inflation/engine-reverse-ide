from __future__ import annotations

from typing import Any

from .python_render import render_expr

FUNCRESULT_RESULT_TYPES = {"JSON", "TEXT", "IMAGE"}


def parse_funcresult_reference(expr: dict[str, Any]) -> tuple[str, str, str, list[dict[str, Any]]]:
    parts = expr.get("parts", [])
    if len(parts) < 4 or parts[0].get("kind") != "name" or str(parts[0].get("value")) != "FUNCRESULT":
        raise ValueError("FUNCRESULT references must use the form <FUNCRESULT.<function>.<example>.<kind>>.")

    function_part = parts[1]
    example_part = parts[2]
    result_part = parts[3]
    if function_part.get("kind") != "name":
        raise ValueError("FUNCRESULT references must name the source function immediately after FUNCRESULT.")
    if example_part.get("kind") != "name":
        raise ValueError(
            "FUNCRESULT references must name the source example before the result kind, for example "
            "<FUNCRESULT.<function>.<example>.<kind>>."
        )
    if result_part.get("kind") != "name":
        raise ValueError("FUNCRESULT references must include a result kind after the source example: JSON, TEXT, or IMAGE.")

    result_kind = str(result_part.get("value"))
    if result_kind not in FUNCRESULT_RESULT_TYPES:
        raise ValueError("FUNCRESULT references must use the result kind JSON, TEXT, or IMAGE.")

    function_id = str(function_part.get("value"))
    example_name = str(example_part.get("value"))
    tail_parts = list(parts[4:])
    if result_kind != "JSON" and tail_parts:
        raise ValueError(
            f"FUNCRESULT.{function_id}.{example_name}.{result_kind} does not allow further path access. "
            "Use JSON if you need to address nested elements."
        )
    for tail_part in tail_parts:
        if tail_part.get("kind") == "key":
            validate_funcresult_key_selector(tail_part.get("value"), function_id, example_name)

    return function_id, example_name, result_kind, tail_parts


def collect_funcresult_dependencies(expr: Any) -> set[str]:
    dependencies: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            return
        kind = node.get("kind")
        if kind == "ref":
            parts = node.get("parts", [])
            if parts and parts[0].get("kind") == "name" and str(parts[0].get("value")) == "FUNCRESULT":
                function_id, example_name, _result_kind, _tail_parts = parse_funcresult_reference(node)
                dependencies.add(readme_example_key(function_id, example_name))
            for part in parts:
                walk(part.get("value"))
            return
        if kind == "inline_table":
            for item in node.get("items", []):
                walk(item.get("value"))
            return
        if kind == "array":
            for item in node.get("items", []):
                walk(item)
            return
        if kind == "sequence":
            for item in node.get("items", []):
                walk(item)
            return
        if kind == "merge":
            for part in node.get("parts", []):
                walk(part)
            return
        if kind == "call":
            walk(node.get("callee"))
            for arg in node.get("args", []):
                walk(arg.get("value"))
            return
        if kind == "index":
            walk(node.get("value"))
            walk(node.get("index"))
            return

    walk(expr)
    return dependencies


def render_funcresult_reference(
    expr: dict[str, Any],
    base_expr: str,
    *,
    index_self_ref: str = "api",
) -> str:
    function_id, example_name, _result_kind, tail_parts = parse_funcresult_reference(expr)
    rendered = base_expr
    for tail_part in tail_parts:
        tail_kind = tail_part.get("kind")
        if tail_kind == "index":
            rendered += f"[{render_expr(tail_part.get('value'), self_ref=index_self_ref)}]"
        elif tail_kind == "key":
            rendered += f"[{render_funcresult_key_selector(tail_part.get('value'), rendered)}]"
        elif tail_kind == "name":
            rendered += f".{tail_part.get('value')}"
        else:
            raise ValueError(
                f"Unsupported FUNCRESULT tail part kind {tail_kind!r} for source example "
                f"[app.func.{function_id}.examples.{example_name}]."
            )
    return rendered


def render_funcresult_key_selector(index_expr: Any, data_expr: str) -> str:
    index_value = readme_key_selector_number(index_expr)
    if index_value is None:
        raise ValueError("FUNCRESULT @Key selector requires an integer id greater than or equal to -1.")
    if index_value == 0:
        return f"next(iter({data_expr}))"
    if index_value == -1:
        return f"next(reversed({data_expr}))"
    if index_value < -1:
        raise ValueError("FUNCRESULT @Key selector requires an integer id greater than or equal to -1.")
    return f"list({data_expr})[{index_value}]"


def validate_funcresult_key_selector(index_expr: Any, function_id: str, example_name: str) -> None:
    index_value = readme_key_selector_number(index_expr)
    if index_value is None or index_value < -1:
        raise ValueError(
            f"FUNCRESULT.{function_id}.{example_name}.JSON uses @Key with an invalid id. "
            f"Expected an integer greater than or equal to -1."
        )


def readme_key_selector_number(index_expr: Any) -> int | None:
    if not isinstance(index_expr, dict) or index_expr.get("kind") != "number":
        return None
    value = index_expr.get("value")
    if isinstance(value, bool):
        return None
    if not isinstance(value, (int, float)):
        return None
    if not float(value).is_integer():
        return None
    return int(value)


def readme_example_key(function_id: str, example_name: str) -> str:
    return f"{function_id}::{example_name}"
