from __future__ import annotations

import ast
import textwrap
from pathlib import Path
from typing import Any

from .core_naming import (
    abstraction_module_name_from_path,
    class_name_for_group,
    field_name_for_group,
    module_file_name_for_group,
    module_import_name_for_group,
    module_output_dir_for_group,
    module_package_depth_for_group,
    root_client_class_name,
    normalize_abstraction_path,
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
    is_abstraction_reference_expr,
    type_annotation_from_expr,
    type_annotation_from_types,
    type_names_from_expr,
    variable_type_names,
)


def render_init(project: dict[str, Any], package_name: str) -> str:
    client_class_name = root_client_class_name(project)
    return render_template(
        "init.py.tpl",
        {
            "client_class_name": client_class_name,
            "version": project["app"]["version"],
        },
    )


def collect_abstraction_scripts(project: dict[str, Any]) -> list[str]:
    app = project.get("app") or {}
    abstractions = app.get("abstractions") or []
    if not isinstance(abstractions, list):
        raise TypeError("app.abstractions must be a list of abstraction script paths.")
    scripts: list[str] = []
    for path in abstractions:
        if not isinstance(path, str):
            raise TypeError("app.abstractions entries must be strings.")
        text = path.strip()
        if text:
            scripts.append(text)
    return scripts


def collect_public_abstraction_class_names(source_path: Path) -> list[str]:
    source_text = source_path.read_text(encoding="utf-8")
    module = ast.parse(source_text, filename=str(source_path))
    public_class_names: list[str] = []
    for node in module.body:
        if isinstance(node, ast.ClassDef) and not node.name.startswith("_"):
            public_class_names.append(node.name)
    return public_class_names


def resolve_abstraction_source_path(source_root: Path, abstraction_path: str) -> Path:
    source = Path(normalize_abstraction_path(abstraction_path))
    if not source.is_absolute():
        source = source_root / source
    return source


def build_abstraction_package_context(project: dict[str, Any]) -> dict[str, Any]:
    abstraction_scripts = collect_abstraction_scripts(project)
    source_root = Path(project["source_path"]).resolve().parent
    external_modules = []
    external_import_lines: list[str] = []
    for path in abstraction_scripts:
        module_name = abstraction_module_name_from_path(path)
        public_class_names = collect_public_abstraction_class_names(
            resolve_abstraction_source_path(source_root, path)
        )
        external_modules.append(
            {
                "module_name": module_name,
                "source_path": path,
                "public_class_names": public_class_names,
            }
        )
        if public_class_names:
            external_import_lines.append(
                f"from .{module_name} import {', '.join(public_class_names)}"
            )
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
        "external_modules": external_modules,
        "external_import_lines": external_import_lines,
        "has_regexes": bool(project["regexes"]),
        "has_external_abstractions": bool(abstraction_scripts),
    }


def build_variable_context(variable: dict[str, Any]) -> dict[str, Any]:
    type_names = variable_type_names(variable)
    non_null_type_names = {name for name in type_names if name != "null"}
    nullable = bool(variable.get("nullable", False))
    match_values = match_to_values(variable.get("match"))
    match_range = match_to_range(variable.get("match"))
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
        "match_range": match_range,
        "match_range_lower": match_range[0] if match_range is not None else None,
        "match_range_upper": match_range[1] if match_range is not None else None,
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


def numeric_range_error_message(label: str, lower: int | float | None, upper: int | float | None) -> str:
    if lower is not None and upper is not None:
        return f"`{label}` must be between {lower} and {upper}"
    if lower is not None:
        return f"`{label}` must be greater than or equal to {lower}"
    if upper is not None:
        return f"`{label}` must be less than or equal to {upper}"
    return f"`{label}` must be within the configured numeric range"


def build_numeric_range_validation_lines(
    value_name: str,
    match_range: tuple[int | float | None, int | float | None] | None,
    *,
    required: bool,
    label: str,
) -> list[str]:
    if match_range is None:
        return []
    lower, upper = match_range
    comparisons: list[str] = []
    if lower is not None:
        comparisons.append(f"float({value_name}) < {lower}")
    if upper is not None:
        comparisons.append(f"float({value_name}) > {upper}")
    if not comparisons:
        return []
    condition = " or ".join(comparisons)
    if len(comparisons) > 1:
        condition = f"({condition})"
    prefix = "" if required else f"{value_name} is not None and "
    return [
        f"if {prefix}{condition}:",
        f"    raise ValueError({numeric_range_error_message(label, lower, upper)!r})",
    ]


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
    elif variable.get("match_range") is not None:
        lines.extend(build_numeric_range_validation_lines(value_name, variable.get("match_range"), required=True, label=label))
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
    overload_names = list(dict.fromkeys(func.get("overload_names", [])))
    has_overloads = bool(overload_names)
    inputs = [dict(input_spec) for input_spec in func.get("inputs", [])]
    input_allowed_values = build_input_allowed_values_map(func)
    input_overrides: dict[str, dict[str, dict[str, Any]]] = {}
    first_explicit_defaults: dict[str, Any] = {}
    for input_spec in inputs:
        allowed_values = input_allowed_values.get(input_spec["name"])
        if allowed_values is not None:
            input_spec["allowed_values"] = allowed_values
        overrides = {
            str(overload_name): dict(overload_spec)
            for overload_name, overload_spec in (input_spec.get("overloads") or {}).items()
            if isinstance(overload_spec, dict)
        }
        input_spec["overloads"] = overrides
        input_overrides[input_spec["name"]] = overrides
        fallback_default_expr = None
        for overload_name in overload_names:
            override_spec = overrides.get(overload_name) or {}
            if override_spec.get("const") is not None:
                fallback_default_expr = override_spec["const"]
                break
            if override_spec.get("default") is not None:
                fallback_default_expr = override_spec["default"]
                break
        first_explicit_defaults[input_spec["name"]] = fallback_default_expr

    def merge_input_for_overload(input_spec: dict[str, Any], overload_name: str) -> dict[str, Any]:
        merged = dict(input_spec)
        merged.pop("overloads", None)
        override_spec = input_overrides.get(input_spec["name"], {}).get(overload_name) or {}
        if has_overloads:
            merged["required"] = False
        if override_spec.get("type") is not None:
            merged["type"] = override_spec["type"]
        if override_spec.get("description") is not None:
            merged["description"] = override_spec["description"]
        if "required" in override_spec:
            merged["required"] = bool(get_plain_value(override_spec["required"]))
        if "default" in override_spec and override_spec["default"] is not None:
            merged["default"] = override_spec["default"]
            merged["required"] = False
        if "const" in override_spec and override_spec["const"] is not None:
            merged["const"] = override_spec["const"]
            merged["required"] = False
        if override_spec.get("values") is not None:
            merged["values"] = override_spec["values"]
        if override_spec.get("from") is not None:
            merged["from"] = override_spec["from"]
        if override_spec.get("match") is not None:
            merged["match"] = override_spec["match"]
        if override_spec.get("read_only") is not None:
            merged["read_only"] = override_spec["read_only"]
        if overload_name == "default" and merged.get("default") is None and merged.get("const") is None:
            fallback_default_expr = first_explicit_defaults.get(input_spec["name"])
            if fallback_default_expr is not None:
                merged["default"] = fallback_default_expr
                merged["required"] = False
        if merged.get("const") is not None or merged.get("default") is not None:
            merged["required"] = False
        return merged

    def render_signature(inputs_to_render: list[dict[str, Any]], *, omit_const: bool = False, force_optional: bool = False) -> tuple[list[str], list[dict[str, Any]]]:
        signature_parts: list[str] = []
        signature_specs: list[dict[str, Any]] = []
        for input_spec in inputs_to_render:
            if omit_const and input_spec.get("const") is not None:
                continue
            rendered_spec = dict(input_spec)
            rendered_spec.pop("overloads", None)
            if force_optional:
                rendered_spec["required"] = False
                rendered_spec["default"] = None
                rendered_spec["const"] = None
            annotation = render_input_annotation(rendered_spec)
            default_expr = render_input_default(rendered_spec)
            signature_specs.append(
                {
                    "name": rendered_spec["name"],
                    "annotation": annotation,
                    "default_expr": default_expr,
                }
            )
            if default_expr is None:
                signature_parts.append(f"{rendered_spec['name']}: {annotation}")
            else:
                signature_parts.append(f"{rendered_spec['name']}: {annotation} = {default_expr}")
        return signature_parts, signature_specs

    def matched_overload_expr(names: list[str]) -> str:
        quoted_names = [render_simple_value(name) for name in names]
        if len(quoted_names) == 1:
            return f"matched_overload == {quoted_names[0]}"
        return f"matched_overload in [{', '.join(quoted_names)}]"

    def render_selection_conditions(overload_name: str, overload_inputs: list[dict[str, Any]], all_overloads: dict[str, list[dict[str, Any]]]) -> list[str]:
        conditions: list[str] = []
        for input_spec in overload_inputs:
            input_name = input_spec["name"]
            merged_required_like = bool(input_spec.get("required", False)) or input_spec.get("const") is not None
            other_required_like = any(
                (other_spec.get("required", False) or other_spec.get("const") is not None)
                for name, specs in all_overloads.items()
                if name != overload_name
                for other_spec in specs
                if other_spec["name"] == input_name
            )
            if input_spec.get("const") is not None:
                conditions.append(f"{input_name} is None")
            elif merged_required_like:
                conditions.append(f"{input_name} is not None")
            elif other_required_like:
                conditions.append(f"{input_name} is None")
        return conditions

    def render_specialization_lines(overload_name: str, overload_inputs: list[dict[str, Any]]) -> list[str]:
        lines: list[str] = []
        for input_spec in overload_inputs:
            input_name = input_spec["name"]
            const_expr = input_spec.get("const")
            default_expr = input_spec.get("default")
            if const_expr is not None:
                lines.append(f"{input_name} = {render_expr(const_expr, self_ref='self._parent')}")
            elif default_expr is not None:
                lines.append(
                    f"{input_name} = {render_expr(default_expr, self_ref='self._parent')} if {input_name} is None else {input_name}"
                )
        return lines

    def collect_input_names(expr: Any) -> list[str]:
        names: list[str] = []
        seen: set[str] = set()

        def walk(node: Any) -> None:
            if isinstance(node, list):
                for item in node:
                    walk(item)
                return
            if not isinstance(node, dict):
                return
            kind = node.get("kind")
            if kind == "ref":
                input_name = ref_input_name(node)
                if input_name and input_name not in seen:
                    seen.add(input_name)
                    names.append(input_name)
                for part in node.get("parts", []):
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

        walk(expr)
        return names

    def render_wants_condition(wants_value: Any) -> str | None:
        plain_value = get_plain_value(wants_value)
        if isinstance(plain_value, list):
            return f"in {render_simple_value([get_plain_value(item) for item in plain_value])}"
        if plain_value is None:
            return "is None"
        if isinstance(plain_value, bool):
            return "is True" if plain_value else "is False"
        return f"== {render_simple_value(plain_value)}"

    def render_request_url_code(url_spec: dict[str, Any]) -> str:
        url_entries = list(url_spec.get("entries") or [])
        base_url_expr = render_expr(url_spec.get("base"), self_ref="self._parent")
        if not url_entries:
            if base_url_expr == "None":
                return f"raise TypeError({render_simple_value(method_name + '() requires `url.base` to be configured')})"
            return f"request_url = {base_url_expr}"

        explicit_entries: list[tuple[int, dict[str, Any], list[str]]] = []
        fallback_entries: list[tuple[int, dict[str, Any]]] = []
        for index, entry in enumerate(url_entries):
            conditions = [f"{input_name} is not None" for input_name in collect_input_names(entry.get("base"))]
            wants = get_plain_value(entry.get("wants"))
            if isinstance(wants, dict):
                for key, value in wants.items():
                    wants_condition = render_wants_condition(value)
                    if wants_condition is None:
                        continue
                    conditions.append(f"{key} {wants_condition}")
            if conditions:
                explicit_entries.append((index, entry, conditions))
            else:
                fallback_entries.append((index, entry))

        if len(fallback_entries) > 1:
            raise ValueError(f"Function {method_name} defines multiple URL fallbacks without selection conditions.")
        if not explicit_entries:
            if fallback_entries:
                return f"request_url = {render_expr(fallback_entries[0][1].get('base'), self_ref='self._parent')}"
            if base_url_expr == "None":
                return f"raise TypeError({render_simple_value(method_name + '() requires `url.base` to be configured')})"
            return f"request_url = {base_url_expr}"

        ordered_explicit_entries = sorted(
            explicit_entries,
            key=lambda item: (-float(get_plain_value(item[1].get("priority", 0)) or 0), item[0]),
        )
        lines: list[str] = []
        for index, (_entry_index, entry, conditions) in enumerate(ordered_explicit_entries):
            keyword = "if" if index == 0 else "elif"
            lines.append(f"{keyword} {' and '.join(conditions)}:")
            lines.append(f"    request_url = {render_expr(entry.get('base'), self_ref='self._parent')}")

        if fallback_entries:
            lines.append("else:")
            lines.append(f"    request_url = {render_expr(fallback_entries[0][1].get('base'), self_ref='self._parent')}")
        else:
            lines.append("else:")
            lines.append(f"    raise TypeError({render_simple_value(method_name + '() call is ambiguous; URL cannot be collected')})")
        return "\n".join(lines)

    def render_validation_code(base_inputs: list[dict[str, Any]], overload_inputs_by_name: dict[str, list[dict[str, Any]]]) -> str | None:
        if not overload_inputs_by_name:
            return None
        lines: list[str] = []
        for base_input in base_inputs:
            input_name = base_input["name"]
            validation_spec = dict(base_input)
            validation_spec.pop("overloads", None)
            validation_spec["required"] = False
            fallback_values = get_plain_value(validation_spec.get("values"))
            if not isinstance(fallback_values, list):
                fallback_values = []
            special_value_overloads: list[str] = []
            for overload_name, overload_inputs in overload_inputs_by_name.items():
                overload_spec = next((item for item in overload_inputs if item["name"] == input_name), None)
                if overload_spec is None:
                    continue
                values = get_plain_value(overload_spec.get("values"))
                if isinstance(values, list) and values != fallback_values:
                    special_value_overloads.append(overload_name)
            required_overloads = [
                overload_name
                for overload_name, overload_inputs in overload_inputs_by_name.items()
                if next((item for item in overload_inputs if item["name"] == input_name and item.get("required", False)), None)
            ]
            has_checks = bool(
                validation_spec.get("type")
                or validation_spec.get("values")
                or validation_spec.get("match")
            )
            if not has_checks and not required_overloads and not special_value_overloads:
                continue
            if validation_spec.get("type") or validation_spec.get("values") or validation_spec.get("match"):
                item_validation = build_input_validation_context({"inputs": [validation_spec]})[0]
                if item_validation.get("has_checks"):
                    # Reuse the existing non-overloaded validation builder for the fallback branch.
                    if required_overloads:
                        if item_validation.get("required"):
                            item_validation["required"] = False
                    lines.extend(render_validation_item_lines(item_validation))
            if required_overloads:
                match_expr = matched_overload_expr(required_overloads)
                lines.append(f"elif {match_expr}:")
                lines.append(f"    raise ValueError(\"`{input_name}` is required\")")
            if special_value_overloads:
                for overload_name in special_value_overloads:
                    overload_spec = next(item for item in overload_inputs_by_name[overload_name] if item["name"] == input_name)
                    override_values = get_plain_value(overload_spec.get("values")) or []
                    if not isinstance(override_values, list):
                        continue
                    values_expr = render_simple_value(override_values)
                    lines.append(f"if {matched_overload_expr([overload_name])} and {input_name} not in {values_expr}:")
                    if overload_spec.get("values") is not None:
                        lines.append(
                            f"    raise ValueError(\"{input_name} for overload {overload_name} must be one of {values_expr}\")"
                        )
                if fallback_values:
                    lines.append(f"elif {input_name} not in {render_simple_value(fallback_values)}:")
                    lines.append(
                        f"    raise ValueError(\"`{input_name}` must be any of {render_simple_value(fallback_values)}\")"
                    )
        return "\n".join(lines) if lines else None

    def render_validation_item_lines(validation_item: dict[str, Any]) -> list[str]:
        lines: list[str] = []
        if not validation_item.get("has_checks"):
            return lines
        if validation_item.get("required"):
            lines.append(f"if {validation_item['name']} is None:")
            lines.append(f"    raise ValueError(\"`{validation_item['name']}` is required\")")
        abstraction_type_expr = validation_item.get("abstraction_type_expr")
        if abstraction_type_expr:
            if validation_item.get("required"):
                lines.append(
                    f"abstraction.validate_allowed_value({validation_item['name']}, {abstraction_type_expr})"
                )
            else:
                lines.append(f"if {validation_item['name']} is not None:")
                lines.append(
                    f"    abstraction.validate_allowed_value({validation_item['name']}, {abstraction_type_expr})"
                )
            return lines
        if validation_item.get("is_list"):
            if validation_item.get("required"):
                lines.append(f"if not isinstance({validation_item['name']}, list):")
                lines.append(f"    raise TypeError(\"`{validation_item['name']}` must be list\")")
                lines.append(f"for __item in {validation_item['name']}:")
            else:
                lines.append(
                    f"if {validation_item['name']} is not None and not isinstance({validation_item['name']}, list):"
                )
                lines.append(f"    raise TypeError(\"`{validation_item['name']}` must be list\")")
                lines.append(f"if {validation_item['name']} is not None:")
                lines.append(f"    for __item in {validation_item['name']}:")
            target_indent = "    " if validation_item.get("required") else "        "
            if "integer" in validation_item["item_type_names"]:
                lines.append(f"{target_indent}if not isinstance(__item, int) or isinstance(__item, bool):")
                lines.append(f"{target_indent}    raise TypeError(\"`{validation_item['name']}` items must be int\")")
            elif "boolean" in validation_item["item_type_names"]:
                lines.append(f"{target_indent}if not isinstance(__item, bool):")
                lines.append(f"{target_indent}    raise TypeError(\"`{validation_item['name']}` items must be bool\")")
            elif "number" in validation_item["item_type_names"]:
                lines.append(f"{target_indent}if not isinstance(__item, (int, float)) or isinstance(__item, bool):")
                lines.append(f"{target_indent}    raise TypeError(\"`{validation_item['name']}` items must be number\")")
            elif "string" in validation_item["item_type_names"]:
                lines.append(f"{target_indent}if not isinstance(__item, str):")
                lines.append(f"{target_indent}    raise TypeError(\"`{validation_item['name']}` items must be str\")")
        else:
            if "integer" in validation_item["type_names"]:
                if validation_item.get("required"):
                    lines.append(f"if not isinstance({validation_item['name']}, int) or isinstance({validation_item['name']}, bool):")
                    lines.append(f"    raise TypeError(\"`{validation_item['name']}` must be int\")")
                else:
                    lines.append(
                        f"if {validation_item['name']} is not None and (not isinstance({validation_item['name']}, int) or isinstance({validation_item['name']}, bool)):"
                    )
                    lines.append(f"    raise TypeError(\"`{validation_item['name']}` must be int\")")
            elif "boolean" in validation_item["type_names"]:
                if validation_item.get("required"):
                    lines.append(f"if not isinstance({validation_item['name']}, bool):")
                    lines.append(f"    raise TypeError(\"`{validation_item['name']}` must be bool\")")
                else:
                    lines.append(f"if {validation_item['name']} is not None and not isinstance({validation_item['name']}, bool):")
                    lines.append(f"    raise TypeError(\"`{validation_item['name']}` must be bool\")")
            elif "number" in validation_item["type_names"]:
                if validation_item.get("required"):
                    lines.append(f"if not isinstance({validation_item['name']}, (int, float)) or isinstance({validation_item['name']}, bool):")
                    lines.append(f"    raise TypeError(\"`{validation_item['name']}` must be number\")")
                else:
                    lines.append(
                        f"if {validation_item['name']} is not None and (not isinstance({validation_item['name']}, (int, float)) or isinstance({validation_item['name']}, bool)):"
                    )
                    lines.append(f"    raise TypeError(\"`{validation_item['name']}` must be number\")")
            elif "string" in validation_item["type_names"]:
                if validation_item.get("required"):
                    lines.append(f"if not isinstance({validation_item['name']}, str):")
                    lines.append(f"    raise TypeError(\"`{validation_item['name']}` must be str\")")
                else:
                    lines.append(f"if {validation_item['name']} is not None and not isinstance({validation_item['name']}, str):")
                    lines.append(f"    raise TypeError(\"`{validation_item['name']}` must be str\")")
        if validation_item.get("match_check_expr") and not validation_item.get("is_list"):
            if validation_item.get("required"):
                lines.append(f"if not ({validation_item['match_check_expr']}):")
            else:
                lines.append(f"if {validation_item['name']} is not None and not ({validation_item['match_check_expr']}):")
            if validation_item.get("match_error"):
                lines.append(f"    raise ValueError({validation_item['match_error']})")
            else:
                lines.append(
                    f"    raise ValueError(\"`{validation_item['name']}` does not match the expected format\")"
                )
        elif validation_item.get("match_range") and not validation_item.get("is_list"):
            lines.extend(
                build_numeric_range_validation_lines(
                    validation_item["name"],
                    validation_item["match_range"],
                    required=bool(validation_item.get("required")),
                    label=validation_item["name"],
                )
            )
        if validation_item.get("values_expr"):
            if validation_item.get("is_list"):
                if validation_item.get("required"):
                    lines.append(f"for __item in {validation_item['name']}:")
                    lines.append(f"    if __item not in {validation_item['values_expr']}:")
                    lines.append(
                        f"        raise ValueError(\"`{validation_item['name']}` items must be one of {validation_item['values_expr']}\")"
                    )
                else:
                    lines.append(f"if {validation_item['name']} is not None:")
                    lines.append(f"    for __item in {validation_item['name']}:")
                    lines.append(f"        if __item not in {validation_item['values_expr']}:")
                    lines.append(
                        f"            raise ValueError(\"`{validation_item['name']}` items must be one of {validation_item['values_expr']}\")"
                    )
            else:
                if validation_item.get("required"):
                    lines.append(f"if {validation_item['name']} not in {validation_item['values_expr']}:")
                    lines.append(
                        f"    raise ValueError(\"`{validation_item['name']}` must be one of {validation_item['values_expr']}\")"
                    )
                else:
                    lines.append(
                        f"if {validation_item['name']} is not None and {validation_item['name']} not in {validation_item['values_expr']}:"
                    )
                    lines.append(
                        f"    raise ValueError(\"`{validation_item['name']}` must be one of {validation_item['values_expr']}\")"
                    )
        return lines

    def render_overload_validation_code(base_inputs: list[dict[str, Any]], overload_inputs_by_name: dict[str, list[dict[str, Any]]]) -> str | None:
        if not overload_inputs_by_name:
            return None
        lines: list[str] = []
        for base_input in base_inputs:
            input_name = base_input["name"]
            type_expr = base_input.get("type")
            type_names = type_names_from_expr(type_expr)
            is_list = is_list_type_expr(type_expr)
            abstraction_type_expr = render_expr(type_expr, self_ref="self._parent") if is_abstraction_reference_expr(type_expr) else None
            match_check_expr = match_to_check_expr(base_input.get("match"), input_name)
            match_error = match_to_error(base_input.get("match"))
            match_range = match_to_range(base_input.get("match"))
            base_values = selectable_values_from_plain_values(get_plain_value(base_input.get("allowed_values")))
            if not base_values:
                base_values = selectable_values_from_plain_values(get_plain_value(base_input.get("values")))
            required_overloads = [
                overload_name
                for overload_name, overload_inputs in overload_inputs_by_name.items()
                if next((item for item in overload_inputs if item["name"] == input_name and item.get("required", False)), None)
            ]
            value_override_overloads: list[tuple[str, list[Any]]] = []
            for overload_name, overload_inputs in overload_inputs_by_name.items():
                overload_spec = next((item for item in overload_inputs if item["name"] == input_name), None)
                if overload_spec is None:
                    continue
                override_values = selectable_values_from_plain_values(get_plain_value(overload_spec.get("values")))
                if override_values and override_values != base_values:
                    value_override_overloads.append((overload_name, override_values))
            if is_list:
                lines.append(f"if {input_name} is not None and not isinstance({input_name}, list):")
                lines.append(f"    raise TypeError(\"`{input_name}` must be list\")")
                lines.append(f"if {input_name} is not None:")
                lines.append(f"    for __item in {input_name}:")
                if "integer" in type_names:
                    lines.append(f"        if not isinstance(__item, int) or isinstance(__item, bool):")
                    lines.append(f"            raise TypeError(\"`{input_name}` items must be int\")")
                elif "boolean" in type_names:
                    lines.append(f"        if not isinstance(__item, bool):")
                    lines.append(f"            raise TypeError(\"`{input_name}` items must be bool\")")
                elif "number" in type_names:
                    lines.append(f"        if not isinstance(__item, (int, float)) or isinstance(__item, bool):")
                    lines.append(f"            raise TypeError(\"`{input_name}` items must be number\")")
                elif "string" in type_names:
                    lines.append(f"        if not isinstance(__item, str):")
                    lines.append(f"            raise TypeError(\"`{input_name}` items must be str\")")
                if required_overloads:
                    lines.append(f"if {input_name} is None and {matched_overload_expr(required_overloads)}:")
                    lines.append(f"    raise ValueError(\"`{input_name}` is required\")")
            else:
                if "integer" in type_names:
                    lines.append(f"if {input_name} is not None and (not isinstance({input_name}, int) or isinstance({input_name}, bool)):")
                    lines.append(f"    raise TypeError(\"`{input_name}` must be int\")")
                elif "boolean" in type_names:
                    lines.append(f"if {input_name} is not None and not isinstance({input_name}, bool):")
                    lines.append(f"    raise TypeError(\"`{input_name}` must be bool\")")
                elif "number" in type_names:
                    lines.append(f"if {input_name} is not None and (not isinstance({input_name}, (int, float)) or isinstance({input_name}, bool)):")
                    lines.append(f"    raise TypeError(\"`{input_name}` must be number\")")
                elif "string" in type_names:
                    lines.append(f"if {input_name} is not None and not isinstance({input_name}, str):")
                    lines.append(f"    raise TypeError(\"`{input_name}` must be str\")")
                if abstraction_type_expr:
                    lines.append(f"if {input_name} is not None:")
                    lines.append(
                        f"    abstraction.validate_allowed_value({input_name}, {abstraction_type_expr})"
                    )
                if required_overloads:
                    lines.append(f"if {input_name} is None and {matched_overload_expr(required_overloads)}:")
                    lines.append(f"    raise ValueError(\"`{input_name}` is required\")")
            if match_check_expr:
                lines.append(f"if {input_name} is not None and not ({match_check_expr}):")
                if match_error:
                    lines.append(f"    raise ValueError({match_error})")
                else:
                    lines.append(
                        f"    raise ValueError(\"`{input_name}` does not match the expected format\")"
                    )
            elif match_range:
                lines.extend(
                    build_numeric_range_validation_lines(
                        input_name,
                        match_range,
                        required=False,
                        label=input_name,
                    )
                )
            for overload_name, override_values in value_override_overloads:
                lines.append(
                    f"if {matched_overload_expr([overload_name])} and {input_name} not in {render_simple_value(override_values)}:"
                )
                lines.append(
                    f"    raise ValueError(\"{input_name} for overload {overload_name} must be one of {render_simple_value(override_values)}\")"
                )
            if base_values:
                if value_override_overloads:
                    lines.append(f"elif {input_name} is not None and {input_name} not in {render_simple_value(base_values)}:")
                    lines.append(
                        f"    raise ValueError(\"`{input_name}` must be any of {render_simple_value(base_values)}\")"
                    )
                else:
                    lines.append(f"if {input_name} is not None and {input_name} not in {render_simple_value(base_values)}:")
                    lines.append(
                        f"    raise ValueError(\"`{input_name}` must be any of {render_simple_value(base_values)}\")"
                    )
        return "\n".join(lines) if lines else None

    merged_inputs_by_overload: dict[str, list[dict[str, Any]]] = {
        overload_name: [merge_input_for_overload(input_spec, overload_name) for input_spec in inputs]
        for overload_name in overload_names
    }

    def should_include_overload_signature_input(
        input_spec: dict[str, Any],
        overload_name: str,
        overload_inputs_by_name: dict[str, list[dict[str, Any]]],
    ) -> bool:
        if input_spec.get("const") is not None:
            return False
        if input_spec.get("required") or input_spec.get("default") is not None:
            return True
        other_required_like = any(
            (other_spec.get("required") or other_spec.get("const") is not None)
            for name, specs in overload_inputs_by_name.items()
            if name != overload_name
            for other_spec in specs
            if other_spec["name"] == input_spec["name"]
        )
        return not other_required_like

    overload_stub_contexts: list[dict[str, Any]] = []
    for overload_name in overload_names:
        merged_inputs = merged_inputs_by_overload[overload_name]
        signature_parts: list[str] = []
        signature_specs: list[dict[str, Any]] = []
        for input_spec in merged_inputs:
            if not should_include_overload_signature_input(input_spec, overload_name, merged_inputs_by_overload):
                continue
            rendered_spec = dict(input_spec)
            rendered_spec.pop("overloads", None)
            annotation = render_input_annotation(rendered_spec)
            default_expr = render_input_default(rendered_spec)
            signature_specs.append(
                {
                    "name": rendered_spec["name"],
                    "annotation": annotation,
                    "default_expr": default_expr,
                }
            )
            if default_expr is None:
                signature_parts.append(f"{rendered_spec['name']}: {annotation}")
            else:
                signature_parts.append(f"{rendered_spec['name']}: {annotation} = {default_expr}")
        overload_stub_contexts.append(
            {
                "name": overload_name,
                "signature": ", ".join(signature_parts),
                "signature_specs": signature_specs,
            }
        )

    impl_inputs = []
    for input_spec in inputs:
        impl_spec = dict(input_spec)
        impl_spec.pop("overloads", None)
        if has_overloads:
            impl_spec["required"] = False
            impl_spec["default"] = None
            impl_spec["const"] = None
        impl_inputs.append(impl_spec)
    signature_parts, signature_specs = render_signature(impl_inputs, force_optional=has_overloads)
    validation = build_input_validation_context({"inputs": impl_inputs}) if not has_overloads else []
    overload_validation_code = render_overload_validation_code(inputs, merged_inputs_by_overload)
    overload_selection_code = None
    overload_specialization_code = None
    if has_overloads:
        selection_lines: list[str] = ["matched = []"]
        specialization_lines: list[str] = []
        for overload_name in overload_names:
            overload_inputs = merged_inputs_by_overload[overload_name]
            conditions = render_selection_conditions(overload_name, overload_inputs, merged_inputs_by_overload)
            if conditions:
                selection_lines.append(f"if {' and '.join(conditions)}:")
                selection_lines.append(f"    matched.append({render_simple_value(overload_name)})")
            else:
                selection_lines.append(f"matched.append({render_simple_value(overload_name)})")
            specialization_lines.append(f"if {matched_overload_expr([overload_name])}:")
            rendered_specialization = render_specialization_lines(overload_name, overload_inputs)
            if rendered_specialization:
                for line in rendered_specialization:
                    specialization_lines.append(f"    {line}")
            else:
                specialization_lines.append("    pass")
        selection_lines.append("if not matched:")
        selection_lines.append(
            f"    raise TypeError({render_simple_value(method_name + '() expected one of: ' + ', '.join(overload_names))})"
        )
        selection_lines.append("elif len(matched) > 1:")
        selection_lines.append(
            f"    raise TypeError(f\"{method_name}() call is ambiguous; matched overloads: {{matched}}\")"
        )
        selection_lines.append("else:")
        selection_lines.append("    matched_overload = matched[0]")
        overload_selection_code = "\n".join(selection_lines)
        overload_specialization_code = "\n".join(specialization_lines)

    url_spec = func.get("url") or {}
    body = func.get("body")
    headers_spec = func.get("headers")
    extractor = func.get("extractor") or {}
    goto_pipeline = extractor.get("goto_pipeline") or {}
    extractor_script = extractor.get("script")
    query_params = build_query_param_context(func)
    request_url_code = render_request_url_code(url_spec)
    return_annotation = render_return_annotation(func)
    signature_text = ", ".join(signature_parts)
    uses_json_import = any(param.get("list_style_style") == "json" for param in query_params) or bool(
        goto_pipeline.get("module") and goto_pipeline.get("function")
    )
    uses_urlencode_import = bool(query_params)
    uses_path_import = bool(extractor_script)
    uses_re_import = any(
        (validation_item.get("match_check_expr") or "").startswith("re.fullmatch(")
        for validation_item in validation
    ) or bool(overload_validation_code and "re.fullmatch(" in overload_validation_code)
    uses_literal_import = "Literal[" in signature_text or "Literal[" in return_annotation or any(
        "Literal[" in overload_context["signature"] for overload_context in overload_stub_contexts
    )
    uses_http_method_import = transport != "direct"
    uses_method_pipeline_error_import = bool(goto_pipeline.get("module") and goto_pipeline.get("function"))
    if overload_selection_code:
        overload_selection_code = textwrap.indent(overload_selection_code, "        ")
    if overload_specialization_code:
        overload_specialization_code = textwrap.indent(overload_specialization_code, "        ")
    if overload_validation_code:
        overload_validation_code = textwrap.indent(overload_validation_code, "        ")
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
        "signature_kwonly": has_overloads,
        "request_url_code": textwrap.indent(request_url_code, "        "),
        "has_overloads": has_overloads,
        "overloads": overload_stub_contexts,
        "overload_selection_code": overload_selection_code,
        "overload_specialization_code": overload_specialization_code,
        "overload_validation_code": overload_validation_code,
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
        "uses_urlencode_import": uses_urlencode_import,
        "uses_path_import": uses_path_import,
        "uses_re_import": uses_re_import,
        "uses_literal_import": uses_literal_import,
        "uses_http_method_import": uses_http_method_import,
        "uses_method_pipeline_error_import": uses_method_pipeline_error_import,
        "uses_overload_import": has_overloads,
    }


def build_input_validation_context(func: dict[str, Any]) -> list[dict[str, Any]]:
    validations: list[dict[str, Any]] = []
    for input_spec in func.get("inputs", []):
        type_expr = input_spec.get("type")
        type_names = type_names_from_expr(type_expr)
        is_list = is_list_type_expr(type_expr)
        abstraction_type_expr = render_expr(type_expr, self_ref="self._parent") if is_abstraction_reference_expr(type_expr) else None
        match_range = match_to_range(input_spec.get("match"))
        values = input_spec.get("allowed_values")
        if values is None:
            values = get_plain_value(input_spec.get("values"))
        values = selectable_values_from_plain_values(values)
        has_type_checks = is_list or abstraction_type_expr is not None or any(
            type_name in {"integer", "boolean", "number", "string"} for type_name in type_names
        )
        has_value_checks = bool(input_spec.get("match") or values)
        validations.append(
            {
                "name": input_spec["name"],
                "required": bool(input_spec.get("required", False)),
                "type_names": sorted(type_names),
                "item_type_names": sorted(type_names) if is_list else [],
                "is_list": is_list,
                "abstraction_type_expr": abstraction_type_expr,
                "match_pattern": match_to_pattern(input_spec.get("match")),
                "match_check_expr": match_to_check_expr(input_spec.get("match"), input_spec["name"]),
                "match_error": match_to_error(input_spec.get("match")),
                "match_range": match_range,
                "match_range_lower": match_range[0] if match_range is not None else None,
                "match_range_upper": match_range[1] if match_range is not None else None,
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
    *,
    autotest_function_ids: set[str] | None = None,
) -> dict[str, Any]:
    app = project["app"]
    headers_spec = project.get("headers")
    warmup = project.get("warmup") or {}
    warmup_script = warmup.get("script") or {}
    top_groups = top_level_groups(group_tree)
    root_functions = sorted(group_tree.get("functions", []), key=lambda item: item["name"])
    autotest_function_ids = set(autotest_function_ids or set())
    package_root_expr = "Path(__file__).resolve().parent"
    function_contexts = []
    for func in root_functions:
        function_context = build_function_context(
            func,
            root_client_class_name(project),
            autotest_enabled=str(func["id"]) in autotest_function_ids,
            root_import_prefix=".",
            package_root_expr=package_root_expr,
        )
        function_contexts.append(
            {
                "code": render_template("function.py.tpl", function_context),
                "autotest_enabled": function_context["autotest_enabled"],
                "uses_http_method_import": function_context["uses_http_method_import"],
                "uses_json_import": function_context["uses_json_import"],
                "uses_urlencode_import": function_context["uses_urlencode_import"],
                "uses_path_import": function_context["uses_path_import"],
                "uses_re_import": function_context["uses_re_import"],
                "uses_literal_import": function_context["uses_literal_import"],
                "uses_method_pipeline_error_import": function_context["uses_method_pipeline_error_import"],
                "uses_overload_import": function_context["uses_overload_import"],
                "has_overloads": function_context["has_overloads"],
                "overloads": function_context["overloads"],
                "overload_selection_code": function_context["overload_selection_code"],
                "overload_specialization_code": function_context["overload_specialization_code"],
                "overload_validation_code": function_context["overload_validation_code"],
            }
        )
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
        "has_root_functions": bool(function_contexts),
        "functions": function_contexts,
        "has_autotests": any(func_context["autotest_enabled"] for func_context in function_contexts),
        "uses_literal_import": any(func_context.get("uses_literal_import", False) for func_context in function_contexts)
        or any("Literal[" in variable_context["code"] for variable_context in variable_contexts),
        "imports": {
            "http_method": any(func_context.get("uses_http_method_import", False) for func_context in function_contexts),
            "json": any(func_context.get("uses_json_import", False) for func_context in function_contexts),
            "urlencode": any(func_context.get("uses_urlencode_import", False) for func_context in function_contexts),
            "path": any(func_context.get("uses_path_import", False) for func_context in function_contexts),
            "re": any(func_context.get("uses_re_import", False) for func_context in function_contexts),
            "overload": any(func_context.get("uses_overload_import", False) for func_context in function_contexts),
            "method_pipeline_error": any(
                func_context.get("uses_method_pipeline_error_import", False) for func_context in function_contexts
            ),
        },
        "uses_warmup_error_import": bool(warmup_script.get("path") and warmup_script.get("module") and warmup_script.get("function")),
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
                "uses_urlencode_import": function_context["uses_urlencode_import"],
                "uses_path_import": function_context["uses_path_import"],
                "uses_re_import": function_context["uses_re_import"],
                "uses_literal_import": function_context["uses_literal_import"],
                "uses_method_pipeline_error_import": function_context["uses_method_pipeline_error_import"],
                "uses_overload_import": function_context["uses_overload_import"],
                "has_overloads": function_context["has_overloads"],
                "overloads": function_context["overloads"],
                "overload_selection_code": function_context["overload_selection_code"],
                "overload_specialization_code": function_context["overload_specialization_code"],
                "overload_validation_code": function_context["overload_validation_code"],
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
        "uses_overload_import": any(func_context.get("uses_overload_import", False) for func_context in function_contexts),
        "imports": {
            "http_method": any(func_context.get("uses_http_method_import", False) for func_context in function_contexts),
            "json": any(func_context.get("uses_json_import", False) for func_context in function_contexts),
            "urlencode": any(func_context.get("uses_urlencode_import", False) for func_context in function_contexts),
            "path": any(func_context.get("uses_path_import", False) for func_context in function_contexts),
            "re": any(func_context.get("uses_re_import", False) for func_context in function_contexts),
            "literal": any(func_context.get("uses_literal_import", False) for func_context in function_contexts),
            "method_pipeline_error": any(
                func_context.get("uses_method_pipeline_error_import", False) for func_context in function_contexts
            ),
            "overload": any(func_context.get("uses_overload_import", False) for func_context in function_contexts),
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


def render_manager_template(
    project: dict[str, Any],
    package_name: str,
    group_tree: dict[str, Any],
    *,
    autotest_function_ids: set[str] | None = None,
) -> str:
    return render_template(
        "manager.py.tpl",
        build_manager_context(
            project,
            package_name,
            group_tree,
            autotest_function_ids=autotest_function_ids,
        ),
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
    if "const" in input_spec and input_spec["const"] is not None:
        return render_expr(input_spec["const"], self_ref="self._parent")
    if "default" in input_spec and input_spec["default"] is not None:
        return render_expr(input_spec["default"], self_ref="self._parent")
    if not input_spec.get("required", False):
        return "None"
    return None
