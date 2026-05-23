from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

try:
    from jinja2 import Environment, FileSystemLoader, StrictUndefined
except ImportError as exc:  # pragma: no cover - helpful runtime error
    raise RuntimeError(
        "msra_codegen requires Jinja2. Install it with `pip install jinja2`."
    ) from exc

from .python_render import (
    escape_regex_literal,
    get_plain_value,
    regex_class_name,
    render_expr,
    render_headers_expr,
    render_headers_value,
    render_request_cors_mode,
    render_request_credentials,
    render_request_headers,
    render_request_referrer,
    render_simple_value,
    render_text_expr,
)


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


def apply_class_name_pattern(class_name_pattern: str, class_name: str) -> str:
    pattern = str(class_name_pattern or "").strip()
    if not pattern:
        return class_name
    if "{class_name}" in pattern:
        return pattern.format(class_name=class_name)
    return f"{pattern}{class_name}"


def class_name_for_group(path: list[str], class_name_pattern: str = "Class{class_name}") -> str:
    return apply_class_name_pattern(class_name_pattern, base_class_name_for_group(path))


def field_name_for_group(path: list[str]) -> str:
    if not path:
        return "Group"
    return str(path[-1])


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


def build_project(ast: dict[str, Any], msra_path: Path) -> dict[str, Any]:
    tables = [table for table in ast.get("tables", [])]
    table_index: dict[tuple[str, ...], dict[str, Any]] = {
        tuple(table["path"]): table for table in tables
    }

    def get_table(path: list[str] | tuple[str, ...]) -> dict[str, Any] | None:
        return table_index.get(tuple(path))

    def get_assignment(table: dict[str, Any] | None, key: str, default: Any = None) -> Any:
        if not table:
            return default
        for assignment in table.get("assignments", []):
            if assignment.get("key") == key:
                return assignment.get("value")
        return default

    app_table = get_table(["app"])
    app = {
        "name": str(get_plain_value(get_assignment(app_table, "name", "GeneratedAPI"))),
        "description": str(get_plain_value(get_assignment(app_table, "description", ""))),
        "version": str(get_plain_value(get_assignment(app_table, "version", "0.1.0"))),
        "timeout_ms": int(get_plain_value(get_assignment(app_table, "timeout_ms", 35000))),
        "class_name_pattern": str(get_plain_value(get_assignment(app_table, "class_name_pattern", "Class{class_name}"))),
        "browser": str(get_plain_value(get_assignment(app_table, "browser", "camoufox"))),
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

    headers_table = get_table(["app", "func", "headers"])
    headers_spec = build_headers_spec(headers_table, get_assignment)

    warmup_table = get_table(["app", "warmup"])
    warmup_spec = None
    if warmup_table:
        warmup_spec = {
            "humanize": bool(get_plain_value(get_assignment(warmup_table, "humanize", False))),
            "block_images": bool(get_plain_value(get_assignment(warmup_table, "block_images", False))),
            "url": get_assignment(warmup_table, "url"),
            "headers_sniffer": bool(get_plain_value(get_assignment(warmup_table, "headers_sniffer", False))),
            "on_error_screenshot_path": get_plain_value(get_assignment(warmup_table, "on_error_screenshot_path", "")),
            "pipeline": get_assignment(warmup_table, "pipeline"),
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
                "revalue": extract_variable_revalue(types_expr),
                "read_only": bool(get_plain_value(get_assignment(table, "read_only", False))),
                "from": get_assignment(table, "from"),
                "description": get_plain_value(get_assignment(table, "description", "")),
            }
        )

    functions: list[dict[str, Any]] = []
    for table in tables:
        path = table["path"]
        if len(path) != 3 or path[0] != "app" or path[1] != "func":
            continue
        func_id = path[2]
        if func_id == "headers":
            continue

        root = table
        group = str(get_plain_value(get_assignment(root, "group", "")))
        transport = str(get_plain_value(get_assignment(root, "transport", "fetch")))
        method = str(get_plain_value(get_assignment(root, "method", "GET")))
        functions.append(
            {
                "id": func_id,
                "name": str(get_plain_value(get_assignment(root, "name", func_id.lower()))),
                "group": group,
                "transport": transport,
                "method": method,
                "color": get_plain_value(get_assignment(root, "color", "")),
                "description": str(get_plain_value(get_assignment(root, "description", ""))),
                "root_table": root,
                "inputs": [],
                "url": None,
                "body": None,
                "headers": None,
                "postprocess": None,
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
                "data": get_assignment(body_table, "data"),
            }

        func_headers_table = get_table(prefix + ["headers"])
        if func_headers_table:
            func["headers"] = build_headers_spec(func_headers_table, get_assignment)

        postprocess_table = get_table(prefix + ["postprocess"])
        if postprocess_table:
            func["postprocess"] = {
                "render_html": bool(get_plain_value(get_assignment(postprocess_table, "render_html", False))),
                "evaluate": get_plain_value(get_assignment(postprocess_table, "evaluate", "")),
                "goto_pipeline": get_assignment(postprocess_table, "goto_pipeline"),
            }

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


def build_input_spec(table: dict[str, Any], get_assignment) -> dict[str, Any]:
    return {
        "name": table["path"][-1],
        "type": get_assignment(table, "type"),
        "default": get_assignment(table, "default"),
        "required": bool(get_plain_value(get_assignment(table, "required", False))),
        "values": get_assignment(table, "values"),
        "revalue": get_assignment(table, "revalue"),
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
    return {
        "name": table["path"][-1],
        "sub_url": bool(get_plain_value(get_assignment(table, "sub_url", False))),
        "required": bool(get_plain_value(get_assignment(table, "required", False))),
        "list": bool(get_plain_value(get_assignment(table, "list", False))),
        "data": get_assignment(table, "data"),
        "values": get_assignment(table, "values"),
        "description": str(get_plain_value(get_assignment(table, "description", ""))),
    }


def generate_project(
    project: dict[str, Any],
    output_dir: Path,
    package_name: str | None = None,
    source_root: Path | None = None,
) -> None:
    output_dir = output_dir.resolve()
    source_root = source_root.resolve() if source_root is not None else Path(project["source_path"]).resolve().parent
    package_name = package_name or infer_package_name(project["app"]["name"])
    group_tree = build_group_tree(project)

    package_root = output_dir / package_name
    abstraction_root = package_root / "abstraction"
    endpoints_root = package_root / "endpoints"
    postprocess_root = package_root / "postprocess"
    package_root.mkdir(parents=True, exist_ok=True)
    abstraction_root.mkdir(parents=True, exist_ok=True)
    postprocess_root.mkdir(parents=True, exist_ok=True)

    write_text(
        output_dir / "pyproject.toml",
        render_pyproject(project, package_name),
    )
    write_text(package_root / "__init__.py", render_init(project, package_name))
    stale_abstraction_file = package_root / "abstraction.py"
    if stale_abstraction_file.exists():
        stale_abstraction_file.unlink()
    abstraction_context = build_abstraction_package_context(project)
    write_text(
        abstraction_root / "__init__.py",
        render_template("abstraction/__init__.py.tpl", abstraction_context),
    )
    write_text(
        abstraction_root / "regexes.py",
        render_template("abstraction/regexes.py.tpl", abstraction_context),
    )
    if abstraction_context["has_catalog_sort"]:
        write_text(
            abstraction_root / "catalog_sort.py",
            render_template("abstraction/catalog_sort.py.tpl", abstraction_context),
        )
    write_text(package_root / "manager.py", render_manager_template(project, package_name, group_tree))
    if endpoints_root.exists():
        shutil.rmtree(endpoints_root)
    endpoints_root.mkdir(parents=True, exist_ok=True)
    write_text(endpoints_root / "__init__.py", render_endpoints_init(project, package_name, group_tree))
    for group_node in top_level_groups(group_tree):
        write_group_package(group_node, project, package_name, endpoints_root)

    for script in collect_postprocess_scripts(project):
        source = source_root / script
        target = package_root / script
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)


def render_pyproject(project: dict[str, Any], package_name: str) -> str:
    client_class_name = root_client_class_name(project)
    return render_template(
        "pyproject.toml.tpl",
        {
            "package_name": package_name,
            "autotest_start_class": f"{package_name}.{client_class_name}",
        },
    )


def render_init(project: dict[str, Any], package_name: str) -> str:
    client_class_name = root_client_class_name(project)
    exports = abstraction_exports(project)
    return render_template(
        "init.py.tpl",
        {
            "imports": (
                [f"from .abstraction import {', '.join(exports)}"] if exports else []
            )
            + [f"from .manager import {client_class_name}"],
            "exports": exports,
            "client_class_name": client_class_name,
            "version": project["app"]["version"],
        },
    )


def abstraction_exports(project: dict[str, Any]) -> list[str]:
    exports = []
    if project["regexes"]:
        exports.extend(regex_class_name(regex["name"]) for regex in project["regexes"])
    if any(is_catalog_sort_function(func) for func in project["functions"]):
        exports.append("CatalogSort")
    return exports


def build_abstraction_package_context(project: dict[str, Any]) -> dict[str, Any]:
    return {
        "regexes": [
            {
                "name": regex["name"],
                "class_name": regex_class_name(regex["name"]),
                "pattern": escape_regex_literal(str(regex["regex"])),
                "raise_message": render_simple_value(regex["raise"]) if regex["raise"] else None,
                "description": regex["description"],
            }
            for regex in project["regexes"]
        ],
        "has_catalog_sort": any(is_catalog_sort_function(func) for func in project["functions"]),
        "has_regexes": bool(project["regexes"]),
    }


def build_variable_context(variable: dict[str, Any]) -> dict[str, Any]:
    type_names = variable_type_names(variable)
    return {
        "name": variable["name"],
        "description": escape_docstring(variable["description"] or variable["name"]),
        "backing_name": f"_{variable['name']}",
        "capture_expr": render_expr(variable.get("from"), self_ref="self"),
        "capture_kind": primary_type_name(type_names) or "string",
        "getter_return": type_annotation_from_types(type_names) if "| None" in type_annotation_from_types(type_names) else f"{type_annotation_from_types(type_names)} | None",
        "has_integer": "integer" in type_names,
        "has_boolean": "boolean" in type_names,
        "has_number": "number" in type_names,
        "has_string": "string" in type_names or not type_names,
        "has_null": "null" in type_names,
        "setter_enabled": should_render_setter(variable),
        "revalue_pattern": revalue_to_pattern(variable.get("revalue")),
        "revalue_error": revalue_to_error(variable.get("revalue")),
        "revalue_range": revalue_to_range(variable.get("revalue")),
    }


def build_pipeline_step_context(step_expr: dict[str, Any], *, page_ref: str, sniffer_ref: str | None, test_mode_ref: str | None) -> dict[str, Any]:
    step = step_expr if isinstance(step_expr, dict) else get_plain_value(step_expr)
    if not isinstance(step, dict):
        step = {}
    action = step.get("action")
    nested_then = step.get("then")
    then_step = None
    if isinstance(nested_then, dict):
        then_step = build_pipeline_step_context(nested_then, page_ref=page_ref, sniffer_ref=sniffer_ref, test_mode_ref=test_mode_ref)
    elif isinstance(nested_then, str):
        then_step = {
            "kind": "step",
            "action": nested_then,
            "for_tests": bool(step.get("for_tests", False)),
            "state": step.get("state", "load"),
            "state_expr": render_simple_value("networkidle" if step.get("state", "load") == "idle" else step.get("state", "load")),
            "what_expr": render_expr(step.get("what"), self_ref="self._parent"),
            "sniffer_headers": header_names_from_wait_sniffer(step),
            "then_step": None,
            "then": None,
        }
    return {
        "kind": "step",
        "action": action,
        "for_tests": bool(step.get("for_tests", False)),
        "state": step.get("state", "load"),
        "state_expr": render_simple_value("networkidle" if step.get("state", "load") == "idle" else step.get("state", "load")),
        "what_expr": render_expr(step.get("what"), self_ref="self._parent"),
        "sniffer_headers": header_names_from_wait_sniffer(step),
        "sniffer_headers_expr": render_simple_value(header_names_from_wait_sniffer(step)),
        "then_step": then_step,
        "then": nested_then if isinstance(nested_then, str) else None,
        "page_ref": page_ref,
        "sniffer_ref": sniffer_ref,
        "test_mode_ref": test_mode_ref,
    }


def group_consecutive_test_pipeline_steps(steps: list[dict[str, Any]], *, enabled: bool) -> list[dict[str, Any]]:
    if not enabled:
        return steps
    grouped: list[dict[str, Any]] = []
    buffer: list[dict[str, Any]] = []
    for step in steps:
        if step.get("for_tests"):
            buffer.append(step)
            continue
        if buffer:
            grouped.append({"kind": "test_block", "steps": buffer})
            buffer = []
        grouped.append(step)
    if buffer:
        grouped.append({"kind": "test_block", "steps": buffer})
    return grouped


def build_pipeline_steps_context(
    pipeline_expr: dict[str, Any] | None,
    *,
    page_ref: str,
    sniffer_ref: str | None,
    test_mode_ref: str | None,
) -> list[dict[str, Any]]:
    steps = inline_array_to_list(pipeline_expr)
    built_steps = [
        build_pipeline_step_context(step, page_ref=page_ref, sniffer_ref=sniffer_ref, test_mode_ref=test_mode_ref)
        for step in steps
    ]
    return group_consecutive_test_pipeline_steps(built_steps, enabled=test_mode_ref is not None)


def build_function_context(
    func: dict[str, Any],
    root_client_name: str,
) -> dict[str, Any]:
    transport = str(func.get("transport", "fetch"))
    method = str(func.get("method", "GET"))
    method_name = str(func.get("name", func["id"]))
    inputs = func.get("inputs", [])
    signature_parts = []
    signature_specs = []
    for input_spec in inputs:
        arg_name = input_spec["name"]
        annotation = render_input_annotation(input_spec)
        default_expr = render_input_default(input_spec)
        signature_specs.append(
            {
                "name": arg_name,
                "annotation": annotation,
                "default_expr": default_expr,
            }
        )
        if default_expr is None:
            signature_parts.append(f"{arg_name}: {annotation}")
        else:
            signature_parts.append(f"{arg_name}: {annotation} = {default_expr}")

    url_spec = func.get("url") or {}
    body = func.get("body")
    headers_spec = func.get("headers")
    postprocess = func.get("postprocess") or {}
    direct_args: list[str] = []
    if any(input_spec["name"] == "retry_attempts" for input_spec in inputs):
        direct_args.append("retry_attempts=retry_attempts")
    if any(input_spec["name"] == "timeout" for input_spec in inputs):
        direct_args.append("timeout=timeout")
    if not direct_args:
        direct_args = ["retry_attempts=3", "timeout=10"]
    return {
        "method_name": method_name,
        "description": escape_docstring(func.get("description") or method_name),
        "signature": ", ".join(signature_parts),
        "signature_specs": signature_specs,
        "return_annotation": render_return_annotation(func),
        "transport": transport,
        "method": method,
        "url_expr": render_expr(url_spec.get("base"), self_ref="self._parent"),
        "request": {
            "referrer_expr": render_request_referrer(headers_spec, default_if_missing=False),
            "cors_mode_expr": render_request_cors_mode(headers_spec, default_if_missing=False),
            "credentials_expr": render_request_credentials(headers_spec, default_if_missing=False),
            "headers_expr": render_request_headers(headers_spec, default_if_missing=False),
        },
        "body_expr": render_expr(body.get("data"), self_ref="self._parent") if body else None,
        "body_type": body.get("type") if body else None,
        "validation": build_input_validation_context(func),
        "query_params": build_query_param_context(func),
        "direct_args": direct_args,
        "postprocess": {
            "render_html": bool(postprocess.get("render_html", False)),
            "goto_pipeline": build_pipeline_steps_context(
                postprocess.get("goto_pipeline"),
                page_ref="page",
                sniffer_ref=None,
                test_mode_ref=None,
            ),
            "evaluate_path_expr": (
                render_simple_value(str(get_plain_value(postprocess.get("evaluate"))))
                if isinstance(postprocess.get("evaluate"), dict) or isinstance(postprocess.get("evaluate"), str)
                else None
            ),
        },
    }


def build_input_validation_context(func: dict[str, Any]) -> list[dict[str, Any]]:
    validations: list[dict[str, Any]] = []
    for input_spec in func.get("inputs", []):
        type_names = type_names_from_expr(input_spec.get("type"))
        values = get_plain_value(input_spec.get("values"))
        validations.append(
            {
                "name": input_spec["name"],
                "required": bool(input_spec.get("required", False)),
                "type_names": sorted(type_names),
                "revalue_pattern": (
                    revalue_to_pattern(input_spec.get("revalue"))
                ),
                "revalue_error": revalue_to_error(input_spec.get("revalue")),
                "revalue_range": revalue_to_range(input_spec.get("revalue")),
                "values_expr": render_simple_value(values) if isinstance(values, list) and values and all(not isinstance(item, dict) for item in values) else None,
            }
        )
    return validations


def build_query_param_context(func: dict[str, Any]) -> list[dict[str, Any]]:
    url_spec = func.get("url") or {}
    params = url_spec.get("params") or []
    inputs = {normalize_name(input_spec["name"]): input_spec for input_spec in func.get("inputs", [])}
    result: list[dict[str, Any]] = []
    for param in params:
        param_name = param["name"]
        data_expr = param.get("data")
        values = get_plain_value(param.get("values"))
        matched_input = inputs.get(normalize_name(param_name))
        item: dict[str, Any] = {"name": param_name, "name_expr": render_simple_value(param_name)}
        if data_expr is not None:
            item["kind"] = "data"
            item["value_expr"] = render_expr(data_expr, self_ref="self._parent")
            result.append(item)
            continue
        if isinstance(values, list) and len(values) == 1 and isinstance(values[0], dict):
            value_in_url = values[0].get("value_in_url")
            default = bool(values[0].get("default", False))
            if matched_input and "boolean" in type_names_from_expr(matched_input.get("type")) and value_in_url in {True, False, "true", "false"}:
                item.update(
                    {
                        "kind": "boolean_literal",
                        "input_name": matched_input["name"],
                        "value_expr": render_simple_value("true" if str(value_in_url).lower() == "true" else "false"),
                    }
                )
                result.append(item)
                continue
            if default:
                item.update({"kind": "literal", "value_expr": render_simple_value(value_in_url)})
                result.append(item)
                continue
            if matched_input:
                item.update({"kind": "input_passthrough", "input_name": matched_input["name"]})
                result.append(item)
                continue
        if matched_input:
            item.update({"kind": "input_passthrough", "input_name": matched_input["name"]})
            result.append(item)
    return result


def render_variable_block(variable: dict[str, Any]) -> str:
    return render_template("variable.py.tpl", build_variable_context(variable))


def render_function_block(
    func: dict[str, Any],
    root_client_name: str,
) -> str:
    return render_template("function.py.tpl", build_function_context(func, root_client_name))


def build_manager_context(
    project: dict[str, Any],
    package_name: str,
    group_tree: dict[str, Any],
) -> dict[str, Any]:
    app = project["app"]
    headers_spec = project.get("headers")
    warmup = project.get("warmup") or {}
    top_groups = top_level_groups(group_tree)
    return {
        "client_class_name": root_client_class_name(project),
        "app": app,
        "app_name_doc": escape_docstring(app["name"]),
        "package_name": package_name,
        "prefixes": [
            {
                "name": prefix_name,
                "attr_name": f"_{prefix_name}",
                "value": render_simple_value(prefix_value),
            }
            for prefix_name, prefix_value in project["prefixes"].items()
        ],
        "top_groups": [
            {
                "field_name": field_name_for_group(group["path"]),
                "class_name": class_name_for_group(group["path"], app["class_name_pattern"]),
                "module_name": module_import_name_for_group(group),
                "description": escape_docstring(group.get("description") or group["name"]),
            }
            for group in top_groups
        ],
        "variables": [
            {
                **build_variable_context(variable),
                "code": render_variable_block(variable),
            }
            for variable in project["variables"]
        ],
        "warmup": {
            "humanize": bool(warmup.get("humanize", True)),
            "block_images": bool(warmup.get("block_images", True)),
            "url_expr": render_expr(warmup.get("url"), self_ref="self"),
            "headers_sniffer": bool(warmup.get("headers_sniffer", False)),
            "on_error_screenshot_path": render_simple_value(
                warmup.get("on_error_screenshot_path", "screenshot.png")
            ),
            "pipeline": build_pipeline_steps_context(
                warmup.get("pipeline"),
                page_ref="self.page",
                sniffer_ref="sniffer",
                test_mode_ref="self.test_mode",
            ),
        },
        "request": {
            "referrer_expr": render_request_referrer(headers_spec, default_if_missing=True),
            "cors_mode_expr": render_request_cors_mode(headers_spec, default_if_missing=True),
            "credentials_expr": render_request_credentials(headers_spec, default_if_missing=True),
            "headers_expr": render_request_headers(headers_spec, default_if_missing=True),
        },
    }


def build_group_context(
    group_node: dict[str, Any],
    project: dict[str, Any],
    package_name: str,
) -> dict[str, Any]:
    root_client_name = root_client_class_name(project)
    class_name_pattern = project["app"]["class_name_pattern"]
    child_nodes = list(group_node.get("children", {}).values())
    module_depth = module_package_depth_for_group(group_node)
    return {
        "package_name": package_name,
        "root_client_name": root_client_name,
        "root_import_prefix": "." * (module_depth + 1),
        "group_name": ".".join(group_node["path"]) or "MSRA",
        "class_name": class_name_for_group(group_node["path"], class_name_pattern),
        "module_name": module_file_name_for_group(group_node["path"]),
        "module_stem": module_file_name_for_group(group_node["path"])[:-3],
        "description": escape_docstring(group_node.get("description") or "Generated API group."),
        "child_imports": [
            {
                "package_name": module_import_name_for_group(child),
                "class_name": class_name_for_group(child["path"], class_name_pattern),
                "description": escape_docstring(
                    child.get("description")
                    or class_name_for_group(child["path"], class_name_pattern)
                ),
            }
            for child in child_nodes
        ],
        "children": [
            {
                "field_name": field_name_for_group(child["path"]),
                "class_name": class_name_for_group(child["path"], class_name_pattern),
                "description": escape_docstring(
                    child.get("description")
                    or class_name_for_group(child["path"], class_name_pattern)
                ),
            }
            for child in child_nodes
        ],
        "functions": [
            {
                "code": render_function_block(func, root_client_name),
            }
            for func in sorted(group_node.get("functions", []), key=lambda item: item["name"])
        ],
    }


def render_group_block(
    group_node: dict[str, Any],
    project: dict[str, Any],
    package_name: str,
) -> str:
    return render_template(
        "group.py.tpl",
        build_group_context(group_node, project, package_name),
    )


def render_manager_template(project: dict[str, Any], package_name: str, group_tree: dict[str, Any]) -> str:
    return render_template(
        "manager.py.tpl",
        build_manager_context(project, package_name, group_tree),
    )


def render_group_template(
    group_node: dict[str, Any],
    project: dict[str, Any],
    package_name: str,
) -> str:
    return render_group_block(group_node, project, package_name)


def render_group_init_template(
    group_node: dict[str, Any],
    project: dict[str, Any],
    package_name: str,
) -> str:
    return render_template(
        "group_init.py.tpl",
        build_group_context(group_node, project, package_name),
    )


def render_endpoints_init(project: dict[str, Any], package_name: str, group_tree: dict[str, Any]) -> str:
    return render_template(
        "endpoints_init.py.tpl",
        {
            "package_name": package_name,
            "top_groups": [
                {
                    "package_name": module_import_name_for_group(group),
                    "class_name": class_name_for_group(group["path"], project["app"]["class_name_pattern"]),
                    "description": escape_docstring(group.get("description") or group["name"]),
                }
                for group in top_level_groups(group_tree)
            ],
        },
    )


def write_group_package(
    group_node: dict[str, Any],
    project: dict[str, Any],
    package_name: str,
    endpoints_root: Path,
) -> None:
    package_dir = module_output_dir_for_group(group_node, endpoints_root)
    if group_node.get("children"):
        package_dir.mkdir(parents=True, exist_ok=True)
    context = build_group_context(group_node, project, package_name)
    if group_node.get("children"):
        write_text(
            package_dir / "__init__.py",
            render_template("group_init.py.tpl", context),
        )
    write_text(
        package_dir / module_file_name_for_group(group_node["path"]),
        render_template("group.py.tpl", context),
    )
    for child in group_node.get("children", {}).values():
        write_group_package(child, project, package_name, endpoints_root)


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


def extract_variable_revalue(types_expr: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(types_expr, dict) or types_expr.get("kind") != "array":
        return None
    for item in types_expr.get("items", []):
        if not isinstance(item, dict) or item.get("kind") != "inline_table":
            continue
        for inline_item in item.get("items", []):
            if inline_item.get("key") == "revalue":
                return inline_item.get("value")
    return None


def type_annotation_from_types(type_names: set[str]) -> str:
    if not type_names:
        return "Any"
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
    if "null" in type_names:
        return f"{annotation} | None"
    return annotation


def primary_type_name(type_names: set[str]) -> str | None:
    for candidate in ("integer", "number", "boolean", "string", "array", "object", "null"):
        if candidate in type_names:
            return candidate
    return None


def regex_class_name(name: str) -> str:
    return f"Regex{pascal_case(name)}"


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


def variable_revalue_pattern(variable: dict[str, Any]) -> str | None:
    revalue = variable.get("revalue")
    return revalue_to_pattern(revalue)


def revalue_to_pattern(expr: dict[str, Any] | None) -> str | None:
    if not expr:
        return None
    if expr.get("kind") == "string":
        return render_simple_value(expr.get("value"))
    if expr.get("kind") == "ref":
        parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
        if len(parts) >= 3 and parts[0] == "DOCUMENT" and parts[1] == "REGEXES":
            return f"abstraction.{regex_class_name(parts[2])}.REGEX"
    return None


def revalue_to_error(expr: dict[str, Any] | None) -> str | None:
    if not expr or expr.get("kind") != "ref":
        return None
    parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
    if len(parts) >= 3 and parts[0] == "DOCUMENT" and parts[1] == "REGEXES":
        return f"abstraction.{regex_class_name(parts[2])}.ERROR"
    return None


def revalue_to_range(expr: dict[str, Any] | None) -> tuple[int, int] | None:
    if not expr or expr.get("kind") != "inline_table":
        return None
    values = inline_table_to_dict(expr)
    if "from" in values and "to" in values:
        try:
            return int(values["from"]), int(values["to"])
        except (TypeError, ValueError):
            return None
    return None


def is_catalog_sort_function(func: dict[str, Any]) -> bool:
    if func["name"] != "products_list":
        return False
    sort_input = next((item for item in func.get("inputs", []) if item["name"] == "sort"), None)
    if sort_input is None:
        return False
    values = get_plain_value(sort_input.get("values"))
    return values == ["sold", "abc", "min", "max"]


def infer_package_name(app_name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", app_name).strip("_").lower()
    if cleaned in {"fixpriceapi", "fix_price_api", "fixprice_api"}:
        return "fixprice_api"
    if "fixprice" in cleaned and not cleaned.endswith("_api"):
        return "fixprice_api"
    return cleaned or "generated_msra_client"


def collect_postprocess_scripts(project: dict[str, Any]) -> list[str]:
    scripts: list[str] = []
    for func in project["functions"]:
        postprocess = func.get("postprocess")
        if not postprocess:
            continue
        evaluate = postprocess.get("evaluate")
        if isinstance(evaluate, str) and evaluate:
            scripts.append(evaluate)
    return scripts


def header_names_from_wait_sniffer(step: dict[str, Any]) -> list[str]:
    what = step.get("what")
    if isinstance(what, dict) and what.get("kind") == "ref":
        parts = [part["value"] for part in what.get("parts", []) if part.get("kind") == "name"]
        if len(parts) >= 3:
            return [parts[-1]]
    return ["X-Key"]


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def render_return_annotation(func: dict[str, Any]) -> str:
    transport = str(func.get("transport", "fetch"))
    if transport == "goto":
        return "PWResponse"
    if transport == "direct":
        return "BytesIO"
    return "FetchResponse"


def render_input_annotation(input_spec: dict[str, Any]) -> str:
    type_names = type_names_from_expr(input_spec.get("type"))
    base = type_annotation_from_types(type_names)
    values = get_plain_value(input_spec.get("values"))
    if isinstance(values, list) and values and all(not isinstance(item, dict) for item in values):
        literal_values = ", ".join(render_simple_value(item) for item in values)
        base = f"Literal[{literal_values}]"
    default_expr = input_spec.get("default")
    has_explicit_default = default_expr is not None and get_plain_value(default_expr) is not None
    if not input_spec.get("required", False) and not has_explicit_default and "| None" not in base:
        base = f"{base} | None"
    return base


def render_input_default(input_spec: dict[str, Any]) -> str | None:
    if "default" in input_spec and input_spec["default"] is not None:
        return render_expr(input_spec["default"], self_ref="self._parent")
    if not input_spec.get("required", False):
        return "None"
    return None


def normalize_name(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def type_names_from_expr(expr: dict[str, Any] | None) -> set[str]:
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
