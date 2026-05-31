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
    table_index: dict[tuple[str, ...], list[dict[str, Any]]] = {}
    for table in tables:
        table_index.setdefault(tuple(table["path"]), []).append(table)
    examples_by_function: dict[str, list[dict[str, Any]]] = {}

    def get_table(path: list[str] | tuple[str, ...]) -> dict[str, Any] | None:
        entries = table_index.get(tuple(path))
        if not entries:
            return None
        return entries[0]

    def get_tables(path: list[str] | tuple[str, ...]) -> list[dict[str, Any]]:
        return list(table_index.get(tuple(path), []))

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
        "abstractions": [],
    }
    abstractions_value = get_plain_value(get_assignment(app_table, "abstractions", []))
    if not isinstance(abstractions_value, list):
        raise TypeError("app.abstractions must be a list of strings.")
    for item in abstractions_value:
        if not isinstance(item, str):
            raise TypeError("app.abstractions entries must be strings.")
        text = item.strip()
        if text:
            app["abstractions"].append(text)

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
        function_overload_tables = [
            table
            for table in tables
            if len(table["path"]) == 5
            and table["path"][:4] == prefix + ["overload"]
        ]
        overload_names = [str(table["path"][-1]) for table in function_overload_tables]

        input_contexts = []
        for table in input_tables:
            input_name = str(table["path"][-1])
            input_overload_tables = [
                overload_table
                for overload_table in tables
                if len(overload_table["path"]) == 7
                and overload_table["path"][:5] == prefix + ["input", input_name]
                and overload_table["path"][5] == "overload"
            ]
            overload_specs = {
                str(overload_table["path"][-1]): build_input_spec(
                    overload_table,
                    get_assignment,
                    get_assignment_entry,
                    explicit_only=True,
                )
                for overload_table in input_overload_tables
            }
            overload_names.extend(name for name in overload_specs.keys() if name not in overload_names)
            input_context = build_input_spec(table, get_assignment, get_assignment_entry)
            input_context["overloads"] = overload_specs
            input_contexts.append(input_context)
        func["inputs"] = input_contexts
        func["overload_names"] = list(dict.fromkeys(overload_names))

        url_tables = get_tables(prefix + ["url"])
        if url_tables:
            param_tables = [
                table
                for table in tables
                if len(table["path"]) == 6
                and table["path"][:5] == prefix + ["url", "params"]
            ]
            url_entries = []
            for url_table in url_tables:
                url_entries.append(
                    {
                        "base": get_assignment(url_table, "base"),
                        "priority": get_plain_value(get_assignment(url_table, "priority", 0)),
                        "wants": get_assignment(url_table, "wants"),
                    }
                )
            func["url"] = {
                "base": url_entries[0]["base"] if url_entries else None,
                "entries": url_entries,
                "params": [build_url_param_spec(table, get_assignment) for table in param_tables],
            }
        else:
            func["url"] = None

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


def build_input_spec(
    table: dict[str, Any],
    get_assignment,
    get_assignment_entry=None,
    *,
    explicit_only: bool = False,
) -> dict[str, Any]:
    spec: dict[str, Any] = {
        "name": table["path"][-1],
    }

    def assignment_value(key: str, default: Any = None) -> Any:
        if get_assignment_entry is None:
            if explicit_only:
                return default
            return get_assignment(table, key, default)
        entry = get_assignment_entry(table, key)
        if entry is None:
            if explicit_only:
                return None
            return get_assignment(table, key, default)
        return entry.get("value")

    def include(key: str, value: Any) -> None:
        if explicit_only and value is None:
            return
        spec[key] = value

    include("type", assignment_value("type"))
    include("default", assignment_value("default"))
    if not explicit_only:
        include("required", bool(get_plain_value(assignment_value("required", False))))
    else:
        required_value = assignment_value("required")
        if required_value is not None:
            include("required", bool(get_plain_value(required_value)))
    include("const", assignment_value("const"))
    include("values", assignment_value("values"))
    include("match", assignment_value("match"))
    if not explicit_only:
        include("read_only", bool(get_plain_value(assignment_value("read_only", False))))
    else:
        read_only_value = assignment_value("read_only")
        if read_only_value is not None:
            include("read_only", bool(get_plain_value(read_only_value)))
    include("from", assignment_value("from"))
    description_value = assignment_value("description")
    if description_value is None:
        if not explicit_only:
            spec["description"] = ""
    else:
        spec["description"] = str(get_plain_value(description_value))
    return spec


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
