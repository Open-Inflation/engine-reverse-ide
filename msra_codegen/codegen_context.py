from __future__ import annotations

import textwrap
from pathlib import Path
from typing import Any

from .core_naming import (
    class_name_for_group,
    field_name_for_group,
    module_file_name_for_group,
    module_import_name_for_group,
    module_output_dir_for_group,
    module_package_depth_for_group,
    root_client_class_name,
    snake_case,
)
from .file_utils import write_text
from .project_model import top_level_groups
from .python_render import (
    escape_regex_literal,
    get_plain_value,
    header_names_from_wait_sniffer,
    regex_class_name,
    render_expr,
    render_request_cors_mode,
    render_request_credentials,
    render_request_headers,
    render_request_referrer,
    render_simple_value,
    wait_source_expr,
)
from .template_engine import render_template
from .typespec import (
    escape_docstring,
    inline_array_to_list,
    is_list_type_expr,
    match_to_error,
    match_to_pattern,
    match_to_range,
    match_to_values,
    match_to_check_expr,
    normalize_name,
    primary_type_name,
    ref_input_name,
    selectable_values_from_plain_values,
    should_render_setter,
    type_annotation_from_expr,
    type_annotation_from_types,
    type_names_from_expr,
    variable_type_names,
)


def render_init(project: dict[str, Any], package_name: str) -> str:
    client_class_name = root_client_class_name(project)
    exports = abstraction_exports(project)
    return render_template(
        "init.py.tpl",
        {
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
    non_null_type_names = {name for name in type_names if name != "null"}
    nullable = bool(variable.get("nullable", False))
    match_values = match_to_values(variable.get("match"))
    has_null = nullable or "null" in type_names or (match_values is not None and any(value is None for value in match_values))
    context = {
        "name": variable["name"],
        "description": escape_docstring(variable["description"]) if variable["description"] else "",
        "backing_name": f"_{variable['name']}",
        "capture_expr": render_expr(variable.get("from"), self_ref="self"),
        "capture_kind": primary_type_name(non_null_type_names) or "string",
        "getter_return": build_variable_type_annotation(non_null_type_names, nullable=has_null, match_values=match_values),
        "has_integer": "integer" in non_null_type_names,
        "has_boolean": "boolean" in non_null_type_names,
        "has_number": "number" in non_null_type_names,
        "has_string": "string" in non_null_type_names or not non_null_type_names,
        "has_null": has_null,
        "setter_enabled": should_render_setter(variable),
        "match_values": match_values,
        "match_values_expr": render_simple_value(match_values) if match_values is not None else None,
        "match_pattern": match_to_pattern(variable.get("match")),
        "match_check_expr": match_to_check_expr(variable.get("match"), "value"),
        "match_error": match_to_error(variable.get("match")),
        "match_range": match_to_range(variable.get("match")),
    }
    context["warmup_code"] = build_variable_warmup_code(context)
    return context


def build_variable_type_annotation(
    type_names: set[str],
    *,
    nullable: bool,
    match_values: list[Any] | None,
) -> str:
    if match_values:
        literal_values = ", ".join(render_simple_value(value) for value in match_values)
        annotation = f"Literal[{literal_values}]"
        if nullable:
            return f"{annotation} | None"
        return annotation
    return type_annotation_from_types(type_names, nullable=nullable)


def build_variable_warmup_code(variable: dict[str, Any]) -> str:
    raw_name = f"_{variable['name']}_raw"
    value_name = f"_{variable['name']}_value"
    target_expr = f"self.{variable['name']}" if variable.get("setter_enabled") else f"self.{variable['backing_name']}"
    lines = [
        f"{raw_name} = {variable['capture_expr']}",
        f"if {raw_name} is None:",
        f"    {target_expr} = None",
        "else:",
    ]
    if variable.get("setter_enabled"):
        value_lines = build_setter_variable_value_lines(variable, raw_name, value_name, target_expr)
    else:
        value_lines = build_variable_value_lines(variable, raw_name, value_name, target_expr)
    lines.extend(f"    {line}" for line in value_lines)
    return textwrap.indent("\n".join(lines), "        ")


def build_setter_variable_value_lines(
    variable: dict[str, Any],
    raw_name: str,
    value_name: str,
    target_expr: str,
) -> list[str]:
    label = variable["name"]
    kind = str(variable.get("capture_kind") or "string")
    lines: list[str] = []
    if kind == "integer":
        lines.append(f"{value_name} = int({raw_name})")
    elif kind == "number":
        lines.append(f"{value_name} = float({raw_name})")
    elif kind == "boolean":
        lines.extend(
            [
                f"if isinstance({raw_name}, bool):",
                f"    {value_name} = {raw_name}",
                f"elif isinstance({raw_name}, str):",
                f"    lowered = {raw_name}.strip().lower()",
                '    if lowered in {"true", "1", "yes", "on"}:',
                f"        {value_name} = True",
                '    elif lowered in {"false", "0", "no", "off"}:',
                f"        {value_name} = False",
                "    else:",
                f'        raise ValueError(f"`{label}` must be boolean-like")',
                "else:",
                f"    {value_name} = bool({raw_name})",
            ]
        )
    elif kind == "null":
        lines.append(f"{value_name} = None")
    else:
        lines.append(f"{value_name} = {raw_name} if isinstance({raw_name}, str) else str({raw_name})")
    if not variable.get("setter_enabled"):
        lines.extend(build_variable_validation_lines(variable, value_name))
    lines.append(f"{target_expr} = cast({variable['getter_return']}, {value_name})")
    return lines


def build_variable_value_lines(
    variable: dict[str, Any],
    raw_name: str,
    value_name: str,
    target_expr: str,
) -> list[str]:
    label = variable["name"]
    kind = str(variable.get("capture_kind") or "string")
    lines: list[str] = []
    if kind == "integer":
        lines.append(f"{value_name} = int({raw_name})")
    elif kind == "number":
        lines.append(f"{value_name} = float({raw_name})")
    elif kind == "boolean":
        lines.extend(
            [
                f"if isinstance({raw_name}, bool):",
                f"    {value_name} = {raw_name}",
                f"elif isinstance({raw_name}, str):",
                f"    lowered = {raw_name}.strip().lower()",
                '    if lowered in {"true", "1", "yes", "on"}:',
                f"        {value_name} = True",
                '    elif lowered in {"false", "0", "no", "off"}:',
                f"        {value_name} = False",
                "    else:",
                f'        raise ValueError(f"`{label}` must be boolean-like")',
                "else:",
                f"    {value_name} = bool({raw_name})",
            ]
        )
    elif kind == "null":
        lines.append(f"{value_name} = None")
    else:
        lines.append(f"{value_name} = {raw_name} if isinstance({raw_name}, str) else str({raw_name})")
    if not variable.get("setter_enabled"):
        lines.extend(build_variable_validation_lines(variable, value_name))
    lines.append(f"{target_expr} = {value_name}")
    return lines


def build_variable_validation_lines(variable: dict[str, Any], value_name: str) -> list[str]:
    label = variable["name"]
    lines: list[str] = []
    check_expr = match_to_check_expr(variable.get("match"), value_name)
    if check_expr:
        lines.append(f"if not ({check_expr}):")
        if variable.get("match_error"):
            lines.append(f"    raise ValueError({variable['match_error']})")
        else:
            lines.append(f'    raise ValueError("`{label}` does not match the expected format")')
    elif variable.get("match_range"):
        low, high = variable["match_range"]
        lines.append(
            f"if float({value_name}) < {low} or float({value_name}) > {high}:"
        )
        lines.append(
            f'    raise ValueError("`{label}` must be between {low} and {high}")'
        )
    elif variable.get("match_values_expr") is not None:
        lines.append(f"allowed_values = {variable['match_values_expr']}")
        lines.append(f"if {value_name} not in allowed_values:")
        lines.append(f'    raise ValueError(f"`{label}` must be one of {{allowed_values}}")')
    return lines


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
            "state_expr": render_simple_value(step.get("state", "load")),
            "what_expr": render_expr(step.get("what"), self_ref="self._parent"),
            "sniffer_source_expr": wait_source_expr(step.get("source", "request")),
            "sniffer_headers": header_names_from_wait_sniffer(step),
            "then_step": None,
            "then": None,
        }
    return {
        "kind": "step",
        "action": action,
        "for_tests": bool(step.get("for_tests", False)),
        "state": step.get("state", "load"),
        "state_expr": render_simple_value(step.get("state", "load")),
        "what_expr": render_expr(step.get("what"), self_ref="self._parent"),
        "sniffer_source_expr": wait_source_expr(step.get("source", "request")),
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
    *,
    autotest_enabled: bool = False,
    root_import_prefix: str,
    package_root_expr: str,
) -> dict[str, Any]:
    transport = str(func.get("transport", "fetch"))
    method = str(func.get("method", "GET"))
    method_name = str(func.get("name", func["id"]))
    inputs = [dict(input_spec) for input_spec in func.get("inputs", [])]
    signature_parts = []
    signature_specs = []
    input_allowed_values = build_input_allowed_values_map(func)
    for input_spec in inputs:
        allowed_values = input_allowed_values.get(input_spec["name"])
        if allowed_values is not None:
            input_spec["allowed_values"] = allowed_values
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
    extractor = func.get("extractor") or {}
    goto_pipeline = extractor.get("goto_pipeline") or {}
    extractor_script = extractor.get("script")
    validation = build_input_validation_context({"inputs": inputs})
    query_params = build_query_param_context(func)
    url_expr = render_expr(url_spec.get("base"), self_ref="self._parent")
    if url_expr == "None":
        url_input = next((input_spec["name"] for input_spec in inputs if input_spec["name"] == "url"), None)
        if url_input:
            url_expr = url_input
        else:
            url_expr = render_simple_value("")
    return_annotation = render_return_annotation(func)
    signature_text = ", ".join(signature_parts)
    uses_json_import = any(param.get("list_style_style") == "json" for param in query_params) or bool(
        goto_pipeline.get("module") and goto_pipeline.get("function")
    )
    uses_path_import = bool(extractor_script)
    uses_re_import = any(
        (validation_item.get("match_check_expr") or "").startswith("re.fullmatch(")
        for validation_item in validation
    )
    uses_literal_import = "Literal[" in signature_text or "Literal[" in return_annotation
    uses_http_method_import = transport != "direct"
    return {
        "method_name": method_name,
        "description": escape_docstring(func.get("description")) if func.get("description") else "",
        "autotest_enabled": autotest_enabled,
        "signature": signature_text,
        "signature_specs": signature_specs,
        "return_annotation": return_annotation,
        "root_import_prefix": root_import_prefix,
        "transport": transport,
        "method": method,
        "url_expr": url_expr,
        "request": {
            "referrer_expr": render_request_referrer(headers_spec),
            "cors_mode_expr": render_request_cors_mode(headers_spec, default_if_missing=False),
            "credentials_expr": render_request_credentials(headers_spec, default_if_missing=False),
            "headers_expr": render_request_headers(headers_spec, default_if_missing=False),
        },
        "body_expr": render_expr(body.get("from"), self_ref="self._parent") if body else None,
        "body_type": body.get("type") if body else None,
        "validation": validation,
        "query_params": query_params,
        "extractor": {
            "render_html": bool(extractor.get("render_html", False)),
            "script_path_expr": (
                render_simple_value(str(get_plain_value(extractor_script)))
                if extractor_script
                else None
            ),
            "package_root_expr": package_root_expr,
            "goto_pipeline_module": goto_pipeline.get("module") if goto_pipeline else None,
            "goto_pipeline_function": goto_pipeline.get("function") if goto_pipeline else None,
        },
        "uses_json_import": uses_json_import,
        "uses_path_import": uses_path_import,
        "uses_re_import": uses_re_import,
        "uses_literal_import": uses_literal_import,
        "uses_http_method_import": uses_http_method_import,
    }


def build_input_validation_context(func: dict[str, Any]) -> list[dict[str, Any]]:
    validations: list[dict[str, Any]] = []
    for input_spec in func.get("inputs", []):
        type_expr = input_spec.get("type")
        type_names = type_names_from_expr(type_expr)
        is_list = is_list_type_expr(type_expr)
        values = input_spec.get("allowed_values")
        if values is None:
            values = get_plain_value(input_spec.get("values"))
        values = selectable_values_from_plain_values(values)
        has_type_checks = is_list or any(type_name in {"integer", "boolean", "number", "string"} for type_name in type_names)
        has_value_checks = bool(input_spec.get("match") or values)
        validations.append(
            {
                "name": input_spec["name"],
                "required": bool(input_spec.get("required", False)),
                "type_names": sorted(type_names),
                "item_type_names": sorted(type_names) if is_list else [],
                "is_list": is_list,
                "match_pattern": match_to_pattern(input_spec.get("match")),
                "match_check_expr": match_to_check_expr(input_spec.get("match"), input_spec["name"]),
                "match_error": match_to_error(input_spec.get("match")),
                "match_range": match_to_range(input_spec.get("match")),
                "values_expr": render_simple_value(values) if isinstance(values, list) and values and all(not isinstance(item, dict) for item in values) else None,
                "has_checks": bool(input_spec.get("required", False)) or has_type_checks or has_value_checks,
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
        list_style = param.get("list_style") or {}
        from_expr = param.get("from")
        const_expr = param.get("const")
        const_value = get_plain_value(const_expr)
        values = get_plain_value(param.get("values"))
        source_input_name = ref_input_name(from_expr)
        matched_input = inputs.get(normalize_name(source_input_name)) if source_input_name else inputs.get(normalize_name(param_name))
        item: dict[str, Any] = {
            "name": param_name,
            "name_expr": render_simple_value(param_name),
            "source_name": source_input_name or param_name,
            "source_expr": render_expr(from_expr, self_ref="self._parent") if from_expr is not None else None,
            "is_list": bool(param.get("list", False))
            or bool(matched_input and is_list_type_expr(matched_input.get("type")))
            or isinstance(const_value, list),
            "has_value_map": False,
            "selectable_values_expr": None,
            "value_map_expr": None,
            "default_values_expr": None,
            "default_value_expr": None,
            "list_style_style": str(list_style.get("style", "repeat") or "repeat").strip().lower(),
            "list_style_delimiter_expr": render_simple_value(str(list_style.get("delimiter", ",") or ",")),
            "list_style_indexed": bool(list_style.get("indexed", False)),
            "temp_name": f"_{normalize_name(param_name)}_value",
            "temp_list_name": f"_{normalize_name(param_name)}_values",
        }
        if const_expr is not None:
            item["kind"] = "literal"
            if item["is_list"] and not isinstance(const_value, list):
                item["value_expr"] = render_simple_value([const_value])
            else:
                item["value_expr"] = render_expr(const_expr, self_ref="self._parent")
            result.append(item)
            continue
        if from_expr is not None:
            item["kind"] = "from"
            if isinstance(values, list) and values and all(isinstance(entry, dict) for entry in values):
                selectable_entries = [entry for entry in values if entry.get("value") is not None]
                default_entries = [entry for entry in values if entry.get("default")]
                if selectable_entries:
                    item["has_value_map"] = True
                    item["selectable_values_expr"] = render_simple_value([entry["value"] for entry in selectable_entries])
                    item["value_map_expr"] = render_simple_value(
                        {entry["value"]: entry["value_in_url"] for entry in selectable_entries}
                    )
                if default_entries:
                    item["default_values_expr"] = render_simple_value([entry["value_in_url"] for entry in default_entries])
                    if len(default_entries) == 1:
                        item["default_value_expr"] = render_simple_value(default_entries[0]["value_in_url"])
                if not selectable_entries and default_entries:
                    if param.get("list", False) or (matched_input and is_list_type_expr(matched_input.get("type"))):
                        item["value_expr"] = render_simple_value([entry["value_in_url"] for entry in default_entries])
                    else:
                        item["value_expr"] = render_simple_value(default_entries[0]["value_in_url"])
            else:
                item["value_expr"] = render_expr(from_expr, self_ref="self._parent")
            result.append(item)
            continue
        if isinstance(values, list) and values and all(isinstance(entry, dict) for entry in values):
            default_entries = [entry for entry in values if entry.get("default")]
            selectable_entries = [entry for entry in values if entry.get("value") is not None]
            if default_entries:
                item["kind"] = "literal"
                if param.get("list", False):
                    item["value_expr"] = render_simple_value([entry["value_in_url"] for entry in default_entries])
                else:
                    item["value_expr"] = render_simple_value(default_entries[0]["value_in_url"])
                result.append(item)
                continue
            if selectable_entries:
                item["kind"] = "literal"
                if param.get("list", False):
                    item["value_expr"] = render_simple_value([entry["value_in_url"] for entry in selectable_entries])
                else:
                    item["value_expr"] = render_simple_value(selectable_entries[0]["value_in_url"])
                result.append(item)
                continue
        if matched_input:
            item.update({"kind": "input_passthrough", "input_name": matched_input["name"]})
            result.append(item)
    return result


def build_input_allowed_values_map(func: dict[str, Any]) -> dict[str, list[Any]]:
    url_spec = func.get("url") or {}
    params = url_spec.get("params") or []
    result: dict[str, list[Any]] = {}
    for param in params:
        source_input_name = ref_input_name(param.get("from"))
        if not source_input_name or param.get("match") is not None:
            continue
        values = get_plain_value(param.get("values"))
        if not isinstance(values, list):
            continue
        selectable_values = [
            entry.get("value")
            for entry in values
            if isinstance(entry, dict) and entry.get("value") is not None
        ]
        if selectable_values:
            result[source_input_name] = selectable_values
    return result


def render_variable_block(variable: dict[str, Any]) -> str:
    return render_template("variable.py.tpl", build_variable_context(variable))


def render_function_block(
    func: dict[str, Any],
    root_client_name: str,
    *,
    autotest_enabled: bool = False,
    root_import_prefix: str,
    package_root_expr: str,
) -> str:
    return render_template(
        "function.py.tpl",
        build_function_context(
            func,
            root_client_name,
            autotest_enabled=autotest_enabled,
            root_import_prefix=root_import_prefix,
            package_root_expr=package_root_expr,
        ),
    )


def build_manager_context(
    project: dict[str, Any],
    package_name: str,
    group_tree: dict[str, Any],
) -> dict[str, Any]:
    app = project["app"]
    headers_spec = project.get("headers")
    warmup = project.get("warmup") or {}
    warmup_script = warmup.get("script") or {}
    top_groups = top_level_groups(group_tree)
    variable_contexts = [
        {
            **build_variable_context(variable),
            "code": render_variable_block(variable),
        }
        for variable in project["variables"]
    ]
    return {
        "client_class_name": root_client_class_name(project),
        "app": app,
        "app_description": escape_docstring(app["description"]) if app.get("description") else "",
        "package_name": package_name,
        "uses_classvar_import": bool(project["prefixes"]),
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
                "class_name": class_name_for_group(group["path"]),
                "module_name": module_import_name_for_group(group),
                "description": escape_docstring(group.get("description")) if group.get("description") else "",
            }
            for group in top_groups
        ],
        "variables": variable_contexts,
        "uses_literal_import": any("Literal[" in variable_context["code"] for variable_context in variable_contexts),
        "warmup": {
            "headers_sniffer": bool(warmup.get("headers_sniffer", False)),
            "on_error_screenshot_path": render_simple_value(
                warmup.get("on_error_screenshot_path", "screenshot.png")
            ),
            "script_path_expr": render_simple_value(warmup_script.get("path")) if warmup_script else None,
            "script_module": warmup_script.get("module") if warmup_script else None,
            "script_function": warmup_script.get("function") if warmup_script else None,
        },
        "request": {
            "referrer_expr": render_request_referrer(headers_spec),
            "cors_mode_expr": render_request_cors_mode(headers_spec, default_if_missing=True),
            "credentials_expr": render_request_credentials(headers_spec, default_if_missing=True),
            "headers_expr": render_request_headers(headers_spec, default_if_missing=True),
        },
    }


def build_group_context(
    group_node: dict[str, Any],
    project: dict[str, Any],
    package_name: str,
    *,
    autotest_function_ids: set[str] | None = None,
) -> dict[str, Any]:
    root_client_name = root_client_class_name(project)
    child_nodes = list(group_node.get("children", {}).values())
    module_depth = module_package_depth_for_group(group_node)
    package_root_expr = f"Path(__file__).resolve().parents[{module_depth}]"
    autotest_function_ids = set(autotest_function_ids or set())
    function_contexts = []
    for func in sorted(group_node.get("functions", []), key=lambda item: item["name"]):
        function_context = build_function_context(
            func,
            root_client_name,
            autotest_enabled=str(func["id"]) in autotest_function_ids,
            root_import_prefix="." * (module_depth + 1),
            package_root_expr=package_root_expr,
        )
        function_contexts.append(
            {
                "code": render_template("function.py.tpl", function_context),
                "autotest_enabled": function_context["autotest_enabled"],
                "uses_http_method_import": function_context["uses_http_method_import"],
                "uses_json_import": function_context["uses_json_import"],
                "uses_path_import": function_context["uses_path_import"],
                "uses_re_import": function_context["uses_re_import"],
                "uses_literal_import": function_context["uses_literal_import"],
            }
        )
    return {
        "package_name": package_name,
        "root_client_name": root_client_name,
        "root_import_prefix": "." * (module_depth + 1),
        "package_root_expr": package_root_expr,
        "group_name": ".".join(group_node["path"]) or "MSRA",
        "class_name": class_name_for_group(group_node["path"]),
        "module_name": module_file_name_for_group(group_node["path"]),
        "module_stem": module_file_name_for_group(group_node["path"])[:-3],
        "description": escape_docstring(group_node.get("description")) if group_node.get("description") else "",
        "child_imports": [
            {
                "package_name": module_import_name_for_group(child),
                "class_name": class_name_for_group(child["path"]),
                "description": escape_docstring(child.get("description")) if child.get("description") else "",
            }
            for child in child_nodes
        ],
        "children": [
            {
                "field_name": field_name_for_group(child["path"]),
                "class_name": class_name_for_group(child["path"]),
                "description": escape_docstring(child.get("description")) if child.get("description") else "",
            }
            for child in child_nodes
        ],
        "functions": function_contexts,
        "has_autotests": any(func_context["autotest_enabled"] for func_context in function_contexts),
        "imports": {
            "http_method": any(func_context.get("uses_http_method_import", False) for func_context in function_contexts),
            "json": any(func_context.get("uses_json_import", False) for func_context in function_contexts),
            "path": any(func_context.get("uses_path_import", False) for func_context in function_contexts),
            "re": any(func_context.get("uses_re_import", False) for func_context in function_contexts),
            "literal": any(func_context.get("uses_literal_import", False) for func_context in function_contexts),
        },
    }


def render_group_block(
    group_node: dict[str, Any],
    project: dict[str, Any],
    package_name: str,
    *,
    autotest_function_ids: set[str] | None = None,
) -> str:
    return render_template(
        "group.py.tpl",
        build_group_context(
            group_node,
            project,
            package_name,
            autotest_function_ids=autotest_function_ids,
        ),
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
    *,
    autotest_function_ids: set[str] | None = None,
) -> str:
    return render_group_block(
        group_node,
        project,
        package_name,
        autotest_function_ids=autotest_function_ids,
    )


def render_group_init_template(
    group_node: dict[str, Any],
    project: dict[str, Any],
    package_name: str,
    *,
    autotest_function_ids: set[str] | None = None,
) -> str:
    return render_template(
        "group_init.py.tpl",
        build_group_context(
            group_node,
            project,
            package_name,
            autotest_function_ids=autotest_function_ids,
        ),
    )


def render_endpoints_init(project: dict[str, Any], package_name: str, group_tree: dict[str, Any]) -> str:
    return render_template(
        "endpoints_init.py.tpl",
        {
            "package_name": package_name,
            "top_groups": [
                {
                    "package_name": module_import_name_for_group(group),
                    "class_name": class_name_for_group(group["path"]),
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
    *,
    autotest_function_ids: set[str] | None = None,
) -> None:
    package_dir = module_output_dir_for_group(group_node, endpoints_root)
    if group_node.get("children"):
        package_dir.mkdir(parents=True, exist_ok=True)
    context = build_group_context(
        group_node,
        project,
        package_name,
        autotest_function_ids=autotest_function_ids,
    )
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
        write_group_package(
            child,
            project,
            package_name,
            endpoints_root,
            autotest_function_ids=autotest_function_ids,
        )


def is_catalog_sort_function(func: dict[str, Any]) -> bool:
    if func["name"] != "products_list":
        return False
    sort_input = next((item for item in func.get("inputs", []) if item["name"] == "sort"), None)
    if sort_input is None:
        return False
    values = get_plain_value(sort_input.get("values"))
    return values == ["sold", "abc", "min", "max"]


def collect_extractor_scripts(project: dict[str, Any]) -> list[str]:
    scripts: list[str] = []
    for func in project["functions"]:
        extractor = func.get("extractor")
        if not extractor:
            continue
        script = extractor.get("script")
        if isinstance(script, str) and script:
            scripts.append(script)
    return scripts


def collect_goto_pipeline_scripts(project: dict[str, Any]) -> list[str]:
    scripts: list[str] = []
    for func in project["functions"]:
        extractor = func.get("extractor")
        if not extractor:
            continue
        goto_pipeline = extractor.get("goto_pipeline")
        if isinstance(goto_pipeline, dict):
            path = goto_pipeline.get("path")
            if isinstance(path, str) and path:
                scripts.append(path)
    return scripts


def collect_warmup_scripts(project: dict[str, Any]) -> list[str]:
    warmup = project.get("warmup") or {}
    script = warmup.get("script") or {}
    path = script.get("path")
    if isinstance(path, str) and path:
        return [path]
    return []


def render_return_annotation(func: dict[str, Any]) -> str:
    return "abstraction.Output"


def render_input_annotation(input_spec: dict[str, Any]) -> str:
    base = type_annotation_from_expr(input_spec.get("type"))
    values = input_spec.get("allowed_values")
    if values is None:
        values = get_plain_value(input_spec.get("values"))
    values = selectable_values_from_plain_values(values)
    if input_spec.get("match") is None and values:
        literal_values = ", ".join(render_simple_value(item) for item in values)
        if base.startswith("list[") and base.endswith("]"):
            base = f"list[Literal[{literal_values}]]"
        else:
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
