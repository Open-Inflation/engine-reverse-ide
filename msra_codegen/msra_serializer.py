from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


IDENTIFIER_RE = re.compile(r"^[^\W\d][\w-]*$", re.UNICODE)


def render_merged_msra_document(ast: dict[str, Any]) -> str:
    tables = sorted(
        (table for table in ast.get("tables", []) if isinstance(table, dict)),
        key=_table_sort_key,
    )
    blocks: list[str] = []
    for table in tables:
        # Serialize each transformed table as a standalone block in path order.
        block_lines = [f"[{render_table_path(table)}]"]
        assignments = table.get("assignments", [])
        for assignment in assignments if isinstance(assignments, list) else []:
            line = render_assignment(assignment)
            if line:
                block_lines.append(line)
        blocks.append("\n".join(block_lines))
    if not blocks:
        return ""
    return "\n\n".join(blocks) + "\n"


def write_merged_msra_document(ast: dict[str, Any], output_path: Path) -> None:
    output_path = output_path.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render_merged_msra_document(ast), encoding="utf-8")


def _table_sort_key(table: dict[str, Any]) -> tuple[str, ...]:
    path_segments = table.get("pathSegments")
    if isinstance(path_segments, list) and path_segments:
        return tuple(str(segment.get("value", "")) for segment in path_segments if isinstance(segment, dict))
    path = table.get("path")
    if isinstance(path, list):
        return tuple(str(segment) for segment in path)
    return tuple()


def render_table_path(table: dict[str, Any]) -> str:
    path_segments = table.get("pathSegments")
    if isinstance(path_segments, list) and path_segments:
        return ".".join(render_path_segment(segment) for segment in path_segments if isinstance(segment, dict))
    path = table.get("path") or []
    return ".".join(render_path_segment({"value": segment, "quoted": False}) for segment in path)


def render_path_segment(segment: dict[str, Any]) -> str:
    value = str(segment.get("value", ""))
    quoted = bool(segment.get("quoted", False))
    if quoted or not IDENTIFIER_RE.match(value):
        return json.dumps(value, ensure_ascii=False)
    return value


def render_assignment(assignment: dict[str, Any]) -> str:
    if not isinstance(assignment, dict):
        return ""
    if assignment.get("annotation"):
        annotation_name = str(assignment.get("annotationName") or assignment.get("key") or "")
        if assignment.get("annotationHasArguments"):
            value = assignment.get("value")
            if isinstance(value, dict) and value.get("kind") == "bool" and value.get("value") is True:
                return f"@{annotation_name}()"
            return f"@{annotation_name}({render_expr(assignment.get('value'))})"
        return f"@{annotation_name}"
    key = render_assignment_key(str(assignment.get("key", "")), bool(assignment.get("quoted", False)))
    return f"{key}={render_expr(assignment.get('value'))}"


def render_assignment_key(key: str, quoted: bool = False) -> str:
    if quoted or not IDENTIFIER_RE.match(key):
        return json.dumps(key, ensure_ascii=False)
    return key


def render_expr(expr: Any) -> str:
    if expr is None:
        return "null"
    if not isinstance(expr, dict):
        if isinstance(expr, bool):
            return "true" if expr else "false"
        if isinstance(expr, (int, float)) and not isinstance(expr, bool):
            return repr(expr)
        if expr is None:
            return "null"
        return json.dumps(expr, ensure_ascii=False)

    kind = expr.get("kind")
    if kind == "string":
        if not bool(expr.get("quoted", True)):
            return str(expr.get("value", ""))
        return json.dumps(expr.get("value", ""), ensure_ascii=False)
    if kind == "number":
        raw = expr.get("raw")
        if isinstance(raw, str) and raw:
            return raw
        return repr(expr.get("value"))
    if kind == "bool":
        return "true" if expr.get("value") else "false"
    if kind == "null":
        return "null"
    if kind in {"ident", "identifier"}:
        return str(expr.get("value", ""))
    if kind == "ref":
        return render_ref(expr)
    if kind == "array":
        items = expr.get("items", [])
        rendered = ", ".join(render_expr(item) for item in items if item is not None)
        return f"[{rendered}]"
    if kind == "inline_table":
        items = expr.get("items", [])
        rendered = ", ".join(
            f"{render_assignment_key(str(item.get('key', '')), bool(item.get('quoted', False)))}={render_expr(item.get('value'))}"
            for item in items
            if isinstance(item, dict)
        )
        return f"{{{rendered}}}"
    if kind == "sequence":
        items = expr.get("items", [])
        list_rendered = render_list_type_sequence(items)
        if list_rendered is not None:
            return list_rendered
        return " + ".join(render_expr(item) for item in items if item is not None)
    if kind == "merge":
        parts = expr.get("parts", [])
        return " + ".join(render_expr(part) for part in parts if part is not None)
    if kind == "call":
        callee = render_expr(expr.get("callee"))
        args = ", ".join(render_named_arg(arg) for arg in expr.get("args", []) if isinstance(arg, dict))
        return f"{callee}({args})"
    if kind == "index":
        return render_expr(expr.get("value"))
    return "null"


def render_named_arg(arg: dict[str, Any]) -> str:
    name = render_assignment_key(str(arg.get("name", "")))
    return f"{name}={render_expr(arg.get('value'))}"


def render_list_type_sequence(items: list[Any]) -> str | None:
    if len(items) != 2:
      return None
    prefix, suffix = items
    if not is_bare_list_prefix(prefix):
        return None
    if not isinstance(suffix, dict) or suffix.get("kind") != "array":
        return None
    rendered_items = ", ".join(render_expr(item) for item in suffix.get("items", []) if item is not None)
    return f"list[{rendered_items}]"


def is_bare_list_prefix(expr: Any) -> bool:
    if not isinstance(expr, dict):
        return False
    kind = expr.get("kind")
    if kind == "ident":
        return str(expr.get("value", "")) == "list"
    if kind == "string":
        return not bool(expr.get("quoted", True)) and str(expr.get("value", "")) == "list"
    return False


def render_ref(expr: dict[str, Any]) -> str:
    parts = expr.get("parts", [])
    rendered: list[str] = []
    for index, part in enumerate(parts):
        if not isinstance(part, dict):
            continue
        kind = part.get("kind")
        if kind == "name":
            segment = render_path_segment(part)
            if index == 0:
                rendered.append(segment)
            else:
                rendered.append(f".{segment}")
            continue
        if kind == "index":
            rendered.append(f"[{render_expr(part.get('value'))}]")
            continue
        if kind == "key":
            rendered.append(f"[@Key({render_expr(part.get('value'))})]")
            continue
        if kind == "call":
            args = part.get("value", [])
            rendered.append(f"({', '.join(render_named_arg(arg) for arg in args if isinstance(arg, dict))})")
            continue
    return f"<{''.join(rendered)}>"
