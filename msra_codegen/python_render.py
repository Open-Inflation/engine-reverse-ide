from __future__ import annotations

import re
from typing import Any


def pascal_case(text: str) -> str:
    parts = re.split(r"[^A-Za-z0-9]+|_", text)
    cleaned = []
    for part in parts:
        if not part:
            continue
        cleaned.append(part[:1].upper() + part[1:].lower())
    return "".join(cleaned) or "Generated"


def regex_class_name(name: str) -> str:
    return f"Regex{pascal_case(name)}"


def render_simple_value(value: Any) -> str:
    if isinstance(value, str):
        return repr(value)
    if value is None:
        return "None"
    return repr(value)


def escape_regex_literal(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')


def render_request_referrer(headers_spec: dict[str, Any] | None, *, default_if_missing: bool) -> str | None:
    if not headers_spec or headers_spec.get("referrer") is None:
        return "self._MAIN_SITE_ORIGIN" if default_if_missing else None
    return render_ref_value(headers_spec.get("referrer"), self_ref="self")


def render_request_cors_mode(headers_spec: dict[str, Any] | None, *, default_if_missing: bool) -> str | None:
    if not headers_spec or headers_spec.get("cors_mode") is None:
        return render_simple_value("cors") if default_if_missing else None
    return render_simple_value(get_plain_value(headers_spec.get("cors_mode")))


def render_request_credentials(headers_spec: dict[str, Any] | None, *, default_if_missing: bool) -> str | None:
    if not headers_spec or headers_spec.get("credentials") is None:
        return render_simple_value("include") if default_if_missing else None
    return render_simple_value(get_plain_value(headers_spec.get("credentials")))


def render_request_headers(headers_spec: dict[str, Any] | None, *, default_if_missing: bool) -> str | None:
    base = '{"Accept": "application/json, text/plain, */*"}'
    if not headers_spec or headers_spec.get("headers") is None:
        return base if default_if_missing else None
    return render_headers_expr(headers_spec.get("headers"))


def render_ref_value(expr: dict[str, Any] | None, self_ref: str = "self._parent") -> str:
    if expr is None:
        return "None"
    if expr.get("kind") == "ref":
        parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
        if not parts:
            return "None"
        root = parts[0]
        if root == "DOCUMENT" and len(parts) >= 3 and parts[1] == "PREFIXES":
            return f"{self_ref}._{parts[2]}"
        if root == "DOCUMENT" and len(parts) >= 3 and parts[1] == "REGEXES":
            return f"abstraction.{regex_class_name(parts[2])}.REGEX"
        if root == "VARIABLES" and len(parts) >= 2:
            return f"{self_ref}.{parts[1]}"
        if root == "INPUT" and len(parts) >= 2:
            return parts[1]
        if root == "UNSTANDART_HEADERS":
            if len(parts) == 1:
                return f"{self_ref}.unstandard_headers"
            if len(parts) >= 3 and parts[1] == "REQUEST":
                return f"{self_ref}.unstandard_headers.get({render_simple_value(parts[2])})"
            return f"{self_ref}.unstandard_headers"
    return render_expr(expr, self_ref=self_ref)


def render_expr(expr: dict[str, Any] | None, self_ref: str = "self._parent") -> str:
    if expr is None:
        return "None"
    if not isinstance(expr, dict):
        return render_simple_value(expr)
    kind = expr.get("kind")
    if kind == "string":
        return render_simple_value(expr.get("value"))
    if kind == "number":
        return repr(expr.get("value"))
    if kind == "bool":
        return "True" if expr.get("value") else "False"
    if kind == "null":
        return "None"
    if kind == "ref":
        return render_ref_value(expr, self_ref=self_ref)
    if kind == "array":
        return "[" + ", ".join(render_expr(item, self_ref=self_ref) for item in expr.get("items", [])) + "]"
    if kind == "inline_table":
        return "{" + ", ".join(
            f"{render_simple_value(item['key'])}: {render_expr(item['value'], self_ref=self_ref)}"
            for item in expr.get("items", []))
        + "}"
    if kind == "sequence":
        return " + ".join(render_text_expr(item, self_ref=self_ref) for item in expr.get("items", []))
    if kind == "merge":
        parts = expr.get("parts", [])
        inline = next((part for part in parts if part.get("kind") == "inline_table"), None)
        if inline is not None:
            other_parts = [part for part in parts if part is not inline]
            rendered = [render_expr(inline, self_ref=self_ref)] + [render_text_expr(part, self_ref=self_ref) for part in other_parts]
            return " | ".join(rendered)
        return " + ".join(render_text_expr(item, self_ref=self_ref) for item in parts)
    if kind == "call":
        callee = render_expr(expr.get("callee"), self_ref=self_ref)
        args = ", ".join(f"{arg['name']}={render_expr(arg['value'], self_ref=self_ref)}" for arg in expr.get("args", []))
        return f"{callee}({args})"
    if kind == "index":
        return f"{render_expr(expr.get('value'), self_ref=self_ref)}[{render_expr(expr.get('index'), self_ref=self_ref)}]"
    return "None"


def render_text_expr(expr: dict[str, Any] | None, self_ref: str = "self._parent") -> str:
    if expr is None:
        return "None"
    if not isinstance(expr, dict):
        return render_simple_value(expr)
    kind = expr.get("kind")
    if kind == "ref":
        parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
        if not parts:
            return "None"
        root = parts[0]
        if root == "DOCUMENT" and len(parts) >= 3 and parts[1] == "PREFIXES":
            return f"str({self_ref}._{parts[2]})"
        if root == "DOCUMENT" and len(parts) >= 3 and parts[1] == "REGEXES":
            return f"abstraction.{regex_class_name(parts[2])}.REGEX"
        if root == "VARIABLES" and len(parts) >= 2:
            return f"str({self_ref}.{parts[1]})"
        if root == "INPUT" and len(parts) >= 2:
            return f"str({parts[1]})"
        if root == "UNSTANDART_HEADERS":
            if len(parts) == 1:
                return f"str({self_ref}.unstandard_headers)"
            if len(parts) >= 3 and parts[1] == "REQUEST":
                return f"str({self_ref}.unstandard_headers.get({render_simple_value(parts[2])}))"
            return f"str({self_ref}.unstandard_headers)"
    if kind in {"string", "number", "bool", "null"}:
        return render_expr(expr, self_ref=self_ref)
    return render_expr(expr, self_ref=self_ref)


def render_headers_expr(expr: dict[str, Any] | None) -> str:
    if expr is None:
        return "None"
    if not isinstance(expr, dict):
        return render_simple_value(expr)
    kind = expr.get("kind")
    if kind == "merge":
        return " | ".join(render_headers_expr(part) for part in expr.get("parts", []))
    if kind == "inline_table":
        return "{" + ", ".join(
            f"{render_simple_value(item['key'])}: {render_headers_value(item['value'])}"
            for item in expr.get("items", [])
        ) + "}"
    if kind == "ref":
        parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
        if parts and parts[0] == "UNSTANDART_HEADERS":
            if len(parts) >= 3 and parts[1] == "REQUEST":
                return f"self.unstandard_headers.get({render_simple_value(parts[2])})"
            return "self.unstandard_headers"
    return render_headers_value(expr)


def render_headers_value(expr: dict[str, Any] | None) -> str:
    if expr is None:
        return "None"
    if not isinstance(expr, dict):
        return render_simple_value(expr)
    kind = expr.get("kind")
    if kind == "ref":
        parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
        if parts and parts[0] == "UNSTANDART_HEADERS":
            if len(parts) >= 3 and parts[1] == "REQUEST":
                return f"str(self.unstandard_headers.get({render_simple_value(parts[2])}))"
            return "str(self.unstandard_headers)"
        return render_text_expr(expr, self_ref="self")
    if kind in {"string", "number", "bool", "null"}:
        return render_text_expr(expr, self_ref="self")
    return render_text_expr(expr, self_ref="self")


def get_plain_value(expr: dict[str, Any] | None) -> Any:
    if expr is None:
        return None
    if not isinstance(expr, dict):
        return expr
    kind = expr.get("kind")
    if kind == "string":
        return expr.get("value")
    if kind == "number":
        return expr.get("value")
    if kind == "bool":
        return expr.get("value")
    if kind == "null":
        return None
    if kind == "ref":
        return expr
    if kind == "array":
        return [get_plain_value(item) for item in expr.get("items", [])]
    if kind == "inline_table":
        return {item["key"]: get_plain_value(item["value"]) for item in expr.get("items", [])}
    if kind == "sequence":
        return "".join(str(get_plain_value(item)) for item in expr.get("items", []))
    if kind == "merge":
        return "".join(str(get_plain_value(item)) for item in expr.get("parts", []))
    return expr
