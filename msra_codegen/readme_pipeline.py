from __future__ import annotations

import re
from typing import Any

from .core_naming import snake_case
from .python_render import render_expr


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

    function_order = [func["id"] for func in functions]
    order_index = {func_id: index for index, func_id in enumerate(function_order)}
    primary_examples = {
        func["id"]: choose_primary_example(func.get("examples", []))
        for func in functions
    }
    dependencies: dict[str, set[str]] = {}
    for func_id, example in primary_examples.items():
        deps = collect_funcresult_dependencies(example.get("inputs")) if example else set()
        dependencies[func_id] = {dep for dep in deps if dep in primary_examples}

    ordered_ids = topologically_order_functions(function_order, dependencies, order_index)
    functions_by_id = {func["id"]: func for func in functions}
    output_var_names: dict[str, str] = {}
    body_lines: list[str] = []
    needs_image_helpers = any(
        normalize_example_type(primary_examples.get(func_id)) == "image"
        and str(functions_by_id[func_id].get("transport") or "fetch").lower() == "direct"
        for func_id in ordered_ids
        if primary_examples.get(func_id) is not None
    )
    current_group: str | None = None
    step_index = 0
    for func_id in ordered_ids:
        func = functions_by_id[func_id]
        example = primary_examples[func_id]
        example_type = normalize_example_type(example)
        example_inputs = inline_table_items(example.get("inputs")) if example else []
        group_name = str(func.get("group") or "").split(".", 1)[0] or "Ungrouped"
        if group_name != current_group:
            current_group = group_name
            if body_lines:
                body_lines.append("")
            body_lines.append(f"        # {group_name}")

        step_index += 1
        comment_text = normalize_readme_comment(
            example.get("description") or func.get("description") or func.get("name") or func["id"]
        )
        body_lines.append(f"        # {step_index}. {comment_text}")

        call_path = build_readme_call_path(func)
        transport = str(func.get("transport") or "fetch").lower()
        output_var = readme_output_var_name(func, example_type, transport)
        call_args = build_readme_call_args(example.get("inputs"), output_var_names)
        if example_type == "image" and transport == "direct" and example_inputs:
            url_input = next((item for item in example_inputs if item.get("key") == "url"), None)
            if url_input is not None:
                body_lines.append(f"        image_url = {render_readme_expr(url_input['value'], output_var_names)}")
                body_lines.append(f"        {output_var} = await {call_path}(image_url)")
                body_lines.append("        with Image.open(image_stream) as img:")
                body_lines.append('            print(f"Image format: {img.format}, size: {img.size}")')
                output_var_names[func_id] = output_var
                continue
        if transport == "direct":
            body_lines.append(
                f"        {output_var} = await {call_path}({call_args})" if call_args else f"        {output_var} = await {call_path}()"
            )
        else:
            response_suffix = ".json()"
            if example_type == "text":
                response_suffix = ".text()"
            elif example_type == "image":
                response_suffix = ".image()"
            body_lines.append(
                f"        {output_var} = (await {call_path}({call_args})){response_suffix}"
                if call_args
                else f"        {output_var} = (await {call_path}()){response_suffix}"
            )
        output_var_names[func_id] = output_var

    lines = [
        "import asyncio",
    ]
    if needs_image_helpers:
        lines.append("from PIL import Image")
    lines.extend([
        f"from {package_name} import {client_class_name}",
        "",
        "async def main():",
        f"    async with {client_class_name}() as api:",
    ])
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


def choose_primary_example(examples: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not examples:
        return None
    return sorted(
        enumerate(examples),
        key=lambda item: (
            not bool(item[1].get("docs")),
            not bool(item[1].get("test")),
            item[0],
        ),
    )[0][1]


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


def readme_output_var_name(func: dict[str, Any], example_type: str, transport: str) -> str:
    name = snake_case(str(func.get("name") or func["id"]))
    special_names = {
        "tree": "tree_data",
        "search": "search_results",
    }
    if example_type == "image":
        return "image_stream" if transport == "direct" else "image"
    if name in special_names:
        return special_names[name]
    if name.endswith("_list"):
        name = name[: -len("_list")]
    return name or "result"


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
            if len(parts) >= 3 and parts[0].get("kind") == "name" and str(parts[0].get("value")) == "FUNCRESULT":
                function_part = parts[1]
                if function_part.get("kind") == "name":
                    dependencies.add(str(function_part.get("value")))
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
    if len(parts) < 3 or parts[0].get("kind") != "name" or str(parts[0].get("value")) != "FUNCRESULT":
        return render_expr(expr, self_ref="api")

    function_part = parts[1]
    result_part = parts[2]
    if function_part.get("kind") != "name" or result_part.get("kind") != "name":
        return render_expr(expr, self_ref="api")

    function_id = str(function_part.get("value"))
    base = output_var_names.get(function_id, f"{snake_case(function_id)}_output")
    rendered = base

    for tail_part in parts[3:]:
        tail_kind = tail_part.get("kind")
        if tail_kind == "index":
            rendered += f"[{render_readme_expr(tail_part.get('value'), output_var_names)}]"
        elif tail_kind == "name":
            rendered += f".{tail_part.get('value')}"
    return rendered
