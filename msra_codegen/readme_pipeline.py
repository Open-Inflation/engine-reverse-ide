from __future__ import annotations

import re
from typing import Any

from .core_naming import snake_case
from .python_render import render_expr

FUNCRESULT_RESULT_TYPES = {"JSON", "TEXT", "IMAGE"}


def build_readme_pipeline_note(project: dict[str, Any]) -> str | None:
    if any(not func.get("examples") for func in project.get("functions", [])):
        return (
            "Functions without an `examples` block are omitted from the auto-generated "
            "pipeline because the generator has no concrete inputs to replay."
        )
    return None


def build_readme_pipeline_code(project: dict[str, Any], package_name: str, client_class_name: str) -> str:
    functions = [func for func in project.get("functions", []) if func.get("examples")]
    if not functions:
        return "\n".join(
            [
                "import asyncio",
                f"from {package_name} import {client_class_name}",
                "",
                "async def main():",
                f"    async with {client_class_name}() as api:",
                "        pass",
                "",
                'if __name__ == "__main__":',
                "    asyncio.run(main())",
            ]
        )

    selected_examples_by_function = select_examples_by_function(functions)
    selected_nodes = build_selected_example_nodes(functions, selected_examples_by_function)
    node_order = [node["key"] for node in selected_nodes]
    order_index = {node_key: index for index, node_key in enumerate(node_order)}
    selected_node_keys = set(node_order)
    dependencies: dict[str, set[str]] = {}
    for node in selected_nodes:
        deps = collect_funcresult_dependencies([node["example"].get("inputs"), node["example"].get("print")])
        dependencies[node["key"]] = {dep for dep in deps if dep in selected_node_keys and dep != node["key"]}

    ordered_keys = topologically_order_functions(node_order, dependencies, order_index)
    nodes_by_key = {node["key"]: node for node in selected_nodes}
    output_var_names: dict[str, str] = {}
    body_lines: list[str] = []
    current_group: str | None = None
    for node_key in ordered_keys:
        node = nodes_by_key[node_key]
        func = node["function"]
        example = node["example"]
        function_id = node["function_id"]
        example_name = node["example_name"]
        example_type = normalize_example_type(example)
        group_name = str(func.get("group") or "").split(".", 1)[0] or "Ungrouped"
        if group_name != current_group:
            current_group = group_name
            if body_lines:
                body_lines.append("")
            body_lines.append(f"        # {group_name}")

        comment_text = normalize_readme_comment(example.get("description")) if example.get("description") else ""
        if comment_text:
            body_lines.append(f"        # {comment_text}")

        call_path = build_readme_call_path(func)
        output_var = readme_output_var_name(example_name)
        call_args = build_readme_call_args(example.get("inputs"), output_var_names)
        response_suffix = ".json()"
        if example_type == "text":
            response_suffix = ".text"
        elif example_type == "image":
            response_suffix = ".image()"
        body_lines.append(
            f"        {output_var} = (await {call_path}({call_args})){response_suffix}"
            if call_args
            else f"        {output_var} = (await {call_path}()){response_suffix}"
        )
        output_var_names[node_key] = output_var
        for print_line in render_readme_print_lines(example.get("print"), output_var_names):
            body_lines.append(print_line)

    lines = ["import asyncio"]
    lines.extend(
        [
            f"from {package_name} import {client_class_name}",
            "",
            "async def main():",
            f"    async with {client_class_name}() as api:",
        ]
    )
    if body_lines:
        lines.extend(body_lines)
    else:
        lines.append("        pass")
    lines.extend(
        [
            "",
            'if __name__ == "__main__":',
            "    asyncio.run(main())",
        ]
    )
    return "\n".join(lines)


def select_examples_by_function(
    functions: list[dict[str, Any]],
) -> dict[str, list[str]]:
    examples_by_function = collect_examples_by_function(functions)
    selected: dict[str, set[str]] = {}
    for func in functions:
        function_id = str(func.get("id") or "")
        examples = func.get("examples", [])
        selected_names = select_initial_example_names(examples)
        selected[function_id] = set(selected_names)

    selected_ordered: dict[str, list[str]] = {}
    for func in functions:
        function_id = str(func.get("id") or "")
        examples = func.get("examples", [])
        selected_names = selected.get(function_id, set())
        selected_ordered[function_id] = [
            str(example.get("name"))
            for example in examples
            if str(example.get("name")) in selected_names
        ]
    return selected_ordered


def select_initial_example_names(examples: list[dict[str, Any]]) -> set[str]:
    if not examples:
        return set()

    return {
        str(example.get("name"))
        for example in examples
        if bool(example.get("docs"))
    }


def build_selected_example_nodes(
    functions: list[dict[str, Any]],
    selected_examples_by_function: dict[str, list[str]],
) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    for func in functions:
        function_id = str(func.get("id") or "")
        examples = {str(example.get("name")): example for example in func.get("examples", [])}
        for example_name in selected_examples_by_function.get(function_id, []):
            example = examples.get(example_name)
            if example is None:
                continue
            nodes.append(
                {
                    "key": readme_example_key(function_id, example_name),
                    "function_id": function_id,
                    "function": func,
                    "example_name": example_name,
                    "example": example,
                }
            )
    return nodes


def collect_examples_by_function(functions: list[dict[str, Any]]) -> dict[str, dict[str, dict[str, Any]]]:
    result: dict[str, dict[str, dict[str, Any]]] = {}
    for func in functions:
        function_id = str(func.get("id") or "")
        examples = result.setdefault(function_id, {})
        for example in func.get("examples", []):
            example_name = str(example.get("name") or "")
            if not example_name:
                continue
            examples[example_name] = example
    return result


def readme_example_key(function_id: str, example_name: str) -> str:
    return f"{function_id}::{example_name}"


def normalize_example_type(example: dict[str, Any] | None) -> str:
    if not example:
        return "json"
    value = str(example.get("type") or "json").strip().lower()
    if value not in {"text", "json", "image"}:
        return "json"
    return value


def topologically_order_functions(
    function_order: list[str],
    dependencies: dict[str, set[str]],
    order_index: dict[str, int],
) -> list[str]:
    pending = {func_id: set(dependencies.get(func_id, set())) for func_id in function_order}
    dependents: dict[str, set[str]] = {func_id: set() for func_id in function_order}
    for func_id, deps in pending.items():
        for dep in deps:
            dependents.setdefault(dep, set()).add(func_id)

    ready = sorted([func_id for func_id, deps in pending.items() if not deps], key=order_index.__getitem__)
    ordered: list[str] = []
    while ready:
        func_id = ready.pop(0)
        ordered.append(func_id)
        for child in sorted(dependents.get(func_id, set()), key=order_index.__getitem__):
            child_deps = pending.get(child)
            if child_deps is None:
                continue
            child_deps.discard(func_id)
            if not child_deps and child not in ordered and child not in ready:
                insert_at = 0
                while insert_at < len(ready) and order_index[ready[insert_at]] < order_index[child]:
                    insert_at += 1
                ready.insert(insert_at, child)

    for func_id in function_order:
        if func_id not in ordered:
            ordered.append(func_id)
    return ordered


def build_readme_call_path(func: dict[str, Any]) -> str:
    group = str(func.get("group") or "").strip()
    method_name = str(func.get("name") or func["id"])
    if not group:
        return f"api.{method_name}"
    return "api." + ".".join(segment for segment in group.split(".") if segment) + f".{method_name}"


def readme_output_var_name(example_name: str) -> str:
    return snake_case(str(example_name))


def build_readme_call_args(inputs_expr: dict[str, Any] | None, output_var_names: dict[str, str]) -> str:
    items = inline_table_items(inputs_expr)
    if not items:
        return ""
    return ", ".join(
        f"{item['key']}={render_readme_expr(item['value'], output_var_names)}"
        for item in items
    )


def inline_table_items(expr: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(expr, dict) or expr.get("kind") != "inline_table":
        return []
    return list(expr.get("items", []))


def normalize_readme_comment(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text)).strip()


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
        raise ValueError("FUNCRESULT references must name the source example before the result kind, for example <FUNCRESULT.<function>.<example>.<kind>>.")
    if result_part.get("kind") != "name":
        raise ValueError("FUNCRESULT references must include a result kind after the source example: JSON, TEXT, or IMAGE.")

    result_kind = str(result_part.get("value"))
    if result_kind not in FUNCRESULT_RESULT_TYPES:
        raise ValueError("FUNCRESULT references must use the result kind JSON, TEXT, or IMAGE.")

    function_id = str(function_part.get("value"))
    example_name = str(example_part.get("value"))
    for tail_part in parts[4:]:
        if tail_part.get("kind") != "key":
            continue
        validate_readme_key_selector(tail_part.get("value"), function_id, example_name)
    if result_kind != "JSON" and len(parts) > 4:
        raise ValueError(
            f"FUNCRESULT.{function_id}.{example_name}.{result_kind} does not allow further path access. Use JSON if you need to address nested elements.",
        )

    return function_id, example_name, result_kind, parts[4:]


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


def render_readme_expr(expr: Any, output_var_names: dict[str, str]) -> str:
    if expr is None:
        return "None"
    if not isinstance(expr, dict):
        return render_expr(expr, self_ref="api")
    kind = expr.get("kind")
    if kind == "ref":
        return render_readme_ref(expr, output_var_names)
    if kind == "array":
        return "[" + ", ".join(render_readme_expr(item, output_var_names) for item in expr.get("items", [])) + "]"
    if kind == "inline_table":
        items = ", ".join(
            f"{repr(item['key'])}: {render_readme_expr(item['value'], output_var_names)}"
            for item in expr.get("items", [])
        )
        return "{" + items + "}"
    if kind == "sequence":
        return " + ".join(render_readme_text_expr(item, output_var_names) for item in expr.get("items", []))
    if kind == "merge":
        parts = expr.get("parts", [])
        inline = next((part for part in parts if isinstance(part, dict) and part.get("kind") == "inline_table"), None)
        if inline is not None:
            other_parts = [part for part in parts if part is not inline]
            rendered = [render_readme_expr(inline, output_var_names)] + [
                render_readme_text_expr(part, output_var_names) for part in other_parts
            ]
            return " | ".join(rendered)
        return " + ".join(render_readme_text_expr(item, output_var_names) for item in parts)
    if kind == "call":
        callee = render_readme_expr(expr.get("callee"), output_var_names)
        args = ", ".join(
            f"{arg['name']}={render_readme_expr(arg['value'], output_var_names)}"
            for arg in expr.get("args", [])
        )
        return f"{callee}({args})"
    if kind == "index":
        return f"{render_readme_expr(expr.get('value'), output_var_names)}[{render_readme_expr(expr.get('index'), output_var_names)}]"
    return render_expr(expr, self_ref="api")


def render_readme_print_lines(print_expr: Any, output_var_names: dict[str, str]) -> list[str]:
    if print_expr is None:
        return []
    if isinstance(print_expr, dict) and print_expr.get("kind") == "array":
        lines: list[str] = []
        for item in print_expr.get("items", []):
            lines.extend(render_readme_print_lines(item, output_var_names))
        return lines
    return [f"        print({render_readme_print_value(print_expr, output_var_names)})"]


def render_readme_print_value(expr: Any, output_var_names: dict[str, str]) -> str:
    if isinstance(expr, dict) and expr.get("kind") == "sequence":
        return render_readme_fstring(expr, output_var_names)
    if isinstance(expr, dict) and expr.get("kind") == "merge":
        return render_readme_fstring(expr, output_var_names)
    return render_readme_expr(expr, output_var_names)


def render_readme_fstring(expr: dict[str, Any], output_var_names: dict[str, str]) -> str:
    parts: list[str] = []

    def walk(node: Any) -> None:
        if node is None:
            return
        if isinstance(node, list):
            for item in node:
                walk(item)
            return
        if not isinstance(node, dict):
            parts.append("{" + render_readme_expr(node, output_var_names) + "}")
            return
        kind = node.get("kind")
        if kind == "sequence":
            for item in node.get("items", []):
                walk(item)
            return
        if kind == "merge":
            for part in node.get("parts", []):
                walk(part)
            return
        if kind == "string":
            parts.append(escape_fstring_literal(str(node.get("value", ""))))
            return
        parts.append("{" + render_readme_expr(node, output_var_names) + "}")

    walk(expr)
    return 'f"' + "".join(parts) + '"'


def escape_fstring_literal(text: str) -> str:
    return text.replace("\\", "\\\\").replace("{", "{{").replace("}", "}}").replace('"', '\\"')


def render_readme_text_expr(expr: Any, output_var_names: dict[str, str]) -> str:
    if expr is None:
        return "None"
    if not isinstance(expr, dict):
        return render_expr(expr, self_ref="api")
    kind = expr.get("kind")
    if kind == "ref":
        parts = expr.get("parts", [])
        if len(parts) >= 1 and parts[0].get("kind") == "name" and str(parts[0].get("value")) == "FUNCRESULT":
            return f"str({render_readme_ref(expr, output_var_names)})"
        return render_expr(expr, self_ref="api")
    if kind in {"string", "number", "bool", "null"}:
        return render_expr(expr, self_ref="api")
    return render_readme_expr(expr, output_var_names)


def render_readme_ref(expr: dict[str, Any], output_var_names: dict[str, str]) -> str:
    parts = expr.get("parts", [])
    if len(parts) < 4 or parts[0].get("kind") != "name" or str(parts[0].get("value")) != "FUNCRESULT":
        return render_expr(expr, self_ref="api")

    function_id, example_name, _result_kind, tail_parts = parse_funcresult_reference(expr)
    base = output_var_names.get(readme_example_key(function_id, example_name))
    if base is None:
        raise ValueError(
            f"Referenced example [app.func.{function_id}.examples.{example_name}] is not included in generated docs. "
            f"Mark it @Docs or remove the FUNCRESULT reference."
        )
    rendered = base

    for tail_part in tail_parts:
        tail_kind = tail_part.get("kind")
        if tail_kind == "index":
            rendered += f"[{render_readme_expr(tail_part.get('value'), output_var_names)}]"
        elif tail_kind == "key":
            rendered += f"[{render_readme_key_selector(tail_part.get('value'), rendered)}]"
        elif tail_kind == "name":
            rendered += f".{tail_part.get('value')}"
    return rendered


def render_readme_key_selector(index_expr: Any, data_expr: str) -> str:
    index_value = readme_key_selector_number(index_expr)
    if index_value is None:
        raise ValueError("FUNCRESULT @Key selector requires an integer id greater than or equal to -1.")
    if index_value == 0:
        return f"next(iter({data_expr}))"
    if index_value == -1:
        return f"next(reversed({data_expr}))"
    if index_value < -1:
        raise ValueError("FUNCRESULT @Key selector requires an integer id greater than or equal to -1.")
    rendered_index = str(index_value)
    return f"list({data_expr})[{rendered_index}]"


def validate_readme_key_selector(index_expr: Any, function_id: str, example_name: str) -> None:
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
