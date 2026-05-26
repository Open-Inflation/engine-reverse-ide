from __future__ import annotations

from pathlib import Path
from typing import Any

from .core_naming import group_path_from_expr, parse_script_reference
from .python_render import get_plain_value
from .typespec import extract_variable_match


def build_group_tree(project: dict[str, Any]) -> dict[str, Any]:
    root: dict[str, Any] = {"children": {}, "functions": [], "path": []}
    for group in project.get("groups", []):
        node = root
        for segment in group.get("path", []):
            node = node["children"].setdefault(
                segment,
                {
                    "name": segment,
                    "path": node["path"] + [segment],
                    "description": "",
                    "children": {},
                    "functions": [],
                },
            )
            node["path"] = node["path"]
        node["description"] = group.get("description", "")
    for func in project.get("functions", []):
        path = [part for part in str(func.get("group", "")).split(".") if part]
        node = root
        for segment in path:
            node = node["children"].setdefault(
                segment,
                {
                    "name": segment,
                    "path": node["path"] + [segment],
                    "description": "",
                    "children": {},
                    "functions": [],
                },
            )
        node["functions"].append(func)
    return root


def iter_group_nodes(tree: dict[str, Any]) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []

    def walk(node: dict[str, Any]) -> None:
        for child in node.get("children", {}).values():
            nodes.append(child)
            walk(child)

    walk(tree)
    return nodes


def top_level_groups(tree: dict[str, Any]) -> list[dict[str, Any]]:
    return list(tree.get("children", {}).values())


def build_project(ast: dict[str, Any], msra_path: Path) -> dict[str, Any]:
    tables = [table for table in ast.get("tables", [])]
    table_index: dict[tuple[str, ...], dict[str, Any]] = {
        tuple(table["path"]): table for table in tables
    }
    examples_by_function: dict[str, list[dict[str, Any]]] = {}

    def get_table(path: list[str] | tuple[str, ...]) -> dict[str, Any] | None:
        return table_index.get(tuple(path))

    def get_assignment_entry(table: dict[str, Any] | None, key: str) -> dict[str, Any] | None:
        if not table:
            return None
        for assignment in table.get("assignments", []):
            if assignment.get("key") == key:
                return assignment
        return None

    def get_assignment(table: dict[str, Any] | None, key: str, default: Any = None) -> Any:
        entry = get_assignment_entry(table, key)
        if entry is None:
            return default
        return entry.get("value")

    app_table = get_table(["app"])
    app = {
        "name": str(get_plain_value(get_assignment(app_table, "name", "GeneratedAPI"))),
        "package_name": str(get_plain_value(get_assignment(app_table, "package_name", ""))),
        "package_owner": str(get_plain_value(get_assignment(app_table, "package_owner", ""))),
        "social": get_plain_value(get_assignment(app_table, "social", {})),
        "authors": get_plain_value(get_assignment(app_table, "authors", [])),
        "logo": str(get_plain_value(get_assignment(app_table, "logo", ""))).strip(),
        "license": str(get_plain_value(get_assignment(app_table, "license", "MIT"))),
        "keywords": get_plain_value(get_assignment(app_table, "keywords", [])),
        "min_required_python": str(get_plain_value(get_assignment(app_table, "min_required_python", "3.10"))),
        "description": str(get_plain_value(get_assignment(app_table, "description", ""))),
        "version": str(get_plain_value(get_assignment(app_table, "version", "0.1.0"))),
        "timeout_ms": int(get_plain_value(get_assignment(app_table, "timeout_ms", 35000))),
        "browser": str(get_plain_value(get_assignment(app_table, "browser", "camoufox"))),
        "humanize": get_plain_value(get_assignment(app_table, "humanize", False)),
        "block_images": bool(get_plain_value(get_assignment(app_table, "block_images", False))),
    }

    prefixes_table = get_table(["app", "prefixes"])
    prefixes = {
        assignment["key"]: get_plain_value(assignment["value"])
        for assignment in (prefixes_table or {}).get("assignments", [])
    }

    regex_tables = [
        table
        for table in tables
        if len(table["path"]) == 3 and table["path"][0] == "app" and table["path"][1] == "regexes"
    ]
    regexes: list[dict[str, Any]] = []
    for table in regex_tables:
        regexes.append(
            {
                "name": table["path"][2],
                "regex": get_plain_value(get_assignment(table, "regex", "")),
                "raise": get_plain_value(get_assignment(table, "raise", "")),
                "description": get_plain_value(get_assignment(table, "description", "")),
            }
        )

    groups_tables = [
        table
        for table in tables
        if len(table["path"]) >= 3 and table["path"][0] == "app" and table["path"][1] == "groups"
    ]
    groups = []
    for table in groups_tables:
        groups.append(
            {
                "path": table["path"][2:],
                "name": ".".join(table["path"][2:]),
                "description": get_plain_value(get_assignment(table, "description", "")),
            }
        )

    headers_table = get_table(["app", "defaults", "func", "headers"])
    headers_spec = build_headers_spec(headers_table, get_assignment)

    warmup_table = get_table(["app", "warmup"])
    warmup_spec = None
    if warmup_table:
        warmup_script = parse_script_reference(get_assignment(warmup_table, "warmup"))
        warmup_spec = {
            "headers_sniffer": bool(get_plain_value(get_assignment(warmup_table, "headers_sniffer", False))),
            "on_error_screenshot_path": get_plain_value(get_assignment(warmup_table, "on_error_screenshot_path", "")),
            "script": warmup_script,
        }

    variable_tables = [
        table
        for table in tables
        if len(table["path"]) == 3 and table["path"][0] == "app" and table["path"][1] == "variables"
    ]
    variables = []
    for table in variable_tables:
        types_expr = get_assignment(table, "types")
        variables.append(
            {
                "name": table["path"][2],
                "types": types_expr,
                "match": extract_variable_match(types_expr),
                "read_only": bool(get_plain_value(get_assignment(table, "read_only", False))),
                "nullable": bool(get_plain_value(get_assignment(table, "nullable", False))),
                "from": get_assignment(table, "from"),
                "description": get_plain_value(get_assignment(table, "description", "")),
            }
        )

    functions: list[dict[str, Any]] = []
    for table in tables:
        path = table["path"]
        if len(path) == 5 and path[0] == "app" and path[1] == "func" and path[3] == "examples":
            func_id = path[2]
            docs_assignment = get_assignment_entry(table, "docs")
            examples_by_function.setdefault(func_id, []).append(
                {
                    "name": path[4],
                    "docs": bool(docs_assignment and bool(get_plain_value(docs_assignment.get("value")))),
                    "test": bool(get_plain_value(get_assignment(table, "test", False))),
                    "type": str(get_plain_value(get_assignment(table, "type", "json"))).strip().lower(),
                    "description": str(get_plain_value(get_assignment(table, "description", ""))),
                    "inputs": get_assignment(table, "inputs"),
                    "print": extract_docs_print_value(docs_assignment),
                }
            )
            continue
        if len(path) != 3 or path[0] != "app" or path[1] != "func":
            continue
        func_id = path[2]

        root = table
        group = group_path_from_expr(get_assignment(root, "group", ""))
        transport = str(get_plain_value(get_assignment(root, "transport", "fetch")))
        method = str(get_plain_value(get_assignment(root, "method", "GET")))
        functions.append(
            {
                "id": func_id,
                "name": str(get_plain_value(get_assignment(root, "name", func_id.lower()))),
                "group": group,
                "transport": transport,
                "method": method,
                "description": str(get_plain_value(get_assignment(root, "description", ""))),
                "root_table": root,
                "inputs": [],
                "url": None,
                "body": None,
                "headers": None,
                "extractor": None,
                "examples": examples_by_function.get(func_id, []),
            }
        )

    for func in functions:
        func_id = func["id"]
        prefix = ["app", "func", func_id]
        input_tables = [
            table
            for table in tables
            if len(table["path"]) == 5
            and table["path"][:4] == prefix + ["input"]
        ]
        func["inputs"] = [build_input_spec(table, get_assignment) for table in input_tables]

        url_table = get_table(prefix + ["url"])
        if url_table:
            param_tables = [
                table
                for table in tables
                if len(table["path"]) == 6
                and table["path"][:5] == prefix + ["url", "params"]
            ]
            func["url"] = {
                "base": get_assignment(url_table, "base"),
                "params": [build_url_param_spec(table, get_assignment) for table in param_tables],
            }

        body_table = get_table(prefix + ["body"])
        if body_table:
            func["body"] = {
                "type": str(get_plain_value(get_assignment(body_table, "type", "application/json"))),
                "from": get_assignment(body_table, "from"),
            }

        func_headers_table = get_table(prefix + ["headers"])
        if func_headers_table:
            func["headers"] = build_headers_spec(func_headers_table, get_assignment)

        extractor_table = get_table(prefix + ["extractor"])
        if extractor_table:
            goto_pipeline = parse_script_reference(get_assignment(extractor_table, "goto_pipeline"))
            func["extractor"] = {
                "render_html": bool(get_plain_value(get_assignment(extractor_table, "render_html", False))),
                "script": get_plain_value(get_assignment(extractor_table, "script", "")),
                "goto_pipeline": goto_pipeline,
            }

    for func in functions:
        func["examples"] = examples_by_function.get(func["id"], [])

    return {
        "source_path": str(msra_path.resolve()),
        "app": app,
        "prefixes": prefixes,
        "regexes": regexes,
        "groups": groups,
        "variables": variables,
        "headers": headers_spec,
        "warmup": warmup_spec,
        "functions": functions,
    }


def extract_docs_print_value(docs_assignment: dict[str, Any] | None) -> Any:
    if not docs_assignment or not bool(docs_assignment.get("annotation")):
        return None
    if str(docs_assignment.get("annotationName") or "").lower() != "docs":
        return None
    args = docs_assignment.get("annotationArgs")
    if not isinstance(args, list):
        return None
    for arg in args:
        if isinstance(arg, dict) and str(arg.get("name") or "") == "print":
            return arg.get("value")
    return None


def build_input_spec(table: dict[str, Any], get_assignment) -> dict[str, Any]:
    return {
        "name": table["path"][-1],
        "type": get_assignment(table, "type"),
        "default": get_assignment(table, "default"),
        "required": bool(get_plain_value(get_assignment(table, "required", False))),
        "values": get_assignment(table, "values"),
        "match": get_assignment(table, "match"),
        "read_only": bool(get_plain_value(get_assignment(table, "read_only", False))),
        "from": get_assignment(table, "from"),
        "description": str(get_plain_value(get_assignment(table, "description", ""))),
    }


def build_headers_spec(table: dict[str, Any] | None, get_assignment) -> dict[str, Any] | None:
    if not table:
        return None
    return {
        "referrer": get_assignment(table, "referrer"),
        "cors_mode": get_assignment(table, "cors_mode"),
        "credentials": get_assignment(table, "credentials"),
        "headers": get_assignment(table, "headers"),
    }


def build_url_param_spec(table: dict[str, Any], get_assignment) -> dict[str, Any]:
    list_style = get_plain_value(get_assignment(table, "list_style"))
    if not isinstance(list_style, dict):
        list_style = {}
    return {
        "name": table["path"][-1],
        "sub_url": bool(get_plain_value(get_assignment(table, "sub_url", False))),
        "list": bool(get_plain_value(get_assignment(table, "list", False))),
        "list_style": {
            "style": str(list_style.get("style", "repeat") or "repeat").strip().lower(),
            "delimiter": str(list_style.get("delimiter", ",") or ","),
            "indexed": bool(list_style.get("indexed", False)),
        },
        "from": get_assignment(table, "from"),
        "const": get_assignment(table, "const"),
        "values": get_assignment(table, "values"),
        "description": str(get_plain_value(get_assignment(table, "description", ""))),
    }
