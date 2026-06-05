from __future__ import annotations

from collections import defaultdict, deque
from pathlib import Path
from typing import Any, Callable

from .core_naming import class_name_for_group, group_public_import_path, root_client_class_name, snake_case
from .file_utils import write_text
from .funcresult import parse_funcresult_reference, render_funcresult_reference
from .python_render import render_expr
from .readme_pipeline import build_readme_call_path
from .template_engine import render_template

JSON_EXAMPLE_TYPE = "json"
MEDIA_EXAMPLE_TYPES = {"image", "text"}
SUPPORTED_TEST_EXAMPLE_TYPES = {JSON_EXAMPLE_TYPE, *MEDIA_EXAMPLE_TYPES}


def generate_tests_project(
    project: dict[str, Any],
    output_dir: Path,
    package_name: str,
    group_tree: dict[str, Any],
    *,
    tests_context: dict[str, Any] | None = None,
) -> None:
    del group_tree

    tests_root = output_dir / "tests"
    if tests_root.exists():
        from shutil import rmtree

        rmtree(tests_root)
    tests_root.mkdir(parents=True, exist_ok=True)

    context = tests_context or build_tests_project_context(project, package_name)

    write_text(
        tests_root / "conftest.py",
        render_template("tests/conftest.py.tpl", context["conftest"]),
    )
    write_text(
        tests_root / "api_test.py",
        render_template("tests/api_test.py.tpl", context["api_test"]),
    )
    (tests_root / "__snapshots__").mkdir(parents=True, exist_ok=True)


def build_tests_project_context(project: dict[str, Any], package_name: str) -> dict[str, Any]:
    function_index = build_function_index(project)
    test_dependencies = build_test_example_dependencies(project, function_index)
    selected_json_examples = select_canonical_json_examples(project, function_index, test_dependencies)
    selected_json_keys = {example_key(function_id, example_name) for function_id, example_name in selected_json_examples.items()}

    selected_dependency_map = {
        key: {
            dependency_key
            for dependency_key in test_dependencies.get(key, set())
            if dependency_key in selected_json_keys
        }
        for key in selected_json_keys
    }
    selected_order = topological_example_order(selected_json_keys, selected_dependency_map, function_index)

    autotest_cases = build_autotest_cases(
        selected_order,
        function_index,
        selected_json_examples,
        selected_dependency_map,
        package_name=package_name,
    )
    manual_cases = build_manual_cases(
        project,
        function_index,
        test_dependencies,
        selected_json_examples,
    )
    fixture_cases = build_fixture_cases(
        function_index,
        selected_json_examples,
        test_dependencies,
        manual_cases,
    )
    data_cases = build_autotest_data_cases(project)

    return {
        "autotest_function_ids": set(selected_json_examples.keys()),
        "conftest": {
            "package_name": package_name,
            "client_class_name": root_client_class_name(project),
            "fixtures": fixture_cases,
        },
        "api_test": {
            "package_name": package_name,
            "imports": build_test_import_map(autotest_cases),
            "hooks": [case for case in autotest_cases if case["hook_code"]],
            "providers": autotest_cases,
            "has_provider_dependencies": any(case["dependencies"] for case in autotest_cases),
            "data_cases": data_cases,
            "manual_tests": manual_cases,
        },
    }


def build_function_index(project: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(func["id"]): func for func in project.get("functions", [])}


def build_test_example_dependencies(
    project: dict[str, Any],
    function_index: dict[str, dict[str, Any]],
) -> dict[str, set[str]]:
    dependencies: dict[str, set[str]] = {}
    for func in project.get("functions", []):
        function_id = str(func["id"])
        for example in func.get("examples", []):
            if not bool(example.get("test")):
                continue
            example_label = example_label_for(func, example)
            key = example_key(function_id, str(example["name"]))
            normalize_example_type(example, example_label=example_label)
            dependencies[key] = collect_example_dependencies(
                example,
                function_index,
                current_example_label=example_label,
            )
    return dependencies


def select_canonical_json_examples(
    project: dict[str, Any],
    function_index: dict[str, dict[str, Any]],
    test_dependencies: dict[str, set[str]],
) -> dict[str, str]:
    json_examples_by_function = {
        str(func["id"]): [
            example
            for example in func.get("examples", [])
            if bool(example.get("test"))
            and normalize_example_type(example, example_label=example_label_for(func, example)) == JSON_EXAMPLE_TYPE
        ]
        for func in project.get("functions", [])
    }

    referenced_by: dict[str, set[str]] = defaultdict(set)
    for example_key_value, dependencies in test_dependencies.items():
        for dependency_key in dependencies:
            referenced_by[dependency_key].add(example_key_value)

    selected: dict[str, str] = {}
    selected_keys: set[str] = set()

    for func in project.get("functions", []):
        function_id = str(func["id"])
        json_examples = json_examples_by_function.get(function_id, [])
        if not json_examples:
            continue

        if len(json_examples) == 1:
            chosen = str(json_examples[0]["name"])
        else:
            referenced_candidates = [
                example
                for example in json_examples
                if example_key(function_id, str(example["name"])) in referenced_by
            ]
            if len(referenced_candidates) == 1:
                chosen = str(referenced_candidates[0]["name"])
            elif not referenced_candidates:
                example_names = ", ".join(
                    example_label_for(func, example)
                    for example in json_examples
                )
                raise ValueError(
                    f"Function [app.func.{function_id}] has multiple JSON @Test examples and none of them is selected "
                    f"by downstream tests: {example_names}. Mark exactly one canonical JSON test example."
                )
            else:
                example_names = ", ".join(
                    example_label_for(func, example)
                    for example in referenced_candidates
                )
                raise ValueError(
                    f"Function [app.func.{function_id}] has multiple competing canonical JSON examples: {example_names}."
                )

        selected[function_id] = chosen
        selected_keys.add(example_key(function_id, chosen))

    queue = deque(sorted(selected_keys, key=example_key_sort_key(function_index)))
    while queue:
        current_key = queue.popleft()
        current_function_id, current_example_name = current_key.split("::", 1)
        current_func = function_index[current_function_id]
        current_example = example_by_name(current_func, current_example_name)
        current_label = example_label_for(current_func, current_example)

        for dependency_key in sorted(
            test_dependencies.get(current_key, set()),
            key=example_key_sort_key(function_index),
        ):
            dep_function_id, dep_example_name = dependency_key.split("::", 1)
            dep_func = function_index.get(dep_function_id)
            if dep_func is None:
                raise ValueError(
                    f"Example {current_label} references missing source example "
                    f"[app.func.{dep_function_id}.examples.{dep_example_name}]."
                )
            dep_example = example_by_name(dep_func, dep_example_name)
            dep_label = example_label_for(dep_func, dep_example)
            if not bool(dep_example.get("test")):
                raise ValueError(
                    f"Example {current_label} references {dep_label}, but the referenced example is not marked @Test."
                )
            if normalize_example_type(dep_example, example_label=dep_label) != JSON_EXAMPLE_TYPE:
                raise ValueError(
                    f"Example {current_label} references {dep_label}, but generated tests only support JSON source examples."
                )

            existing = selected.get(dep_function_id)
            if existing is None:
                selected[dep_function_id] = dep_example_name
                selected_key = dependency_key
                selected_keys.add(selected_key)
                queue.append(selected_key)
                continue
            if existing != dep_example_name:
                raise ValueError(
                    f"Example {current_label} requires {dep_label}, but the function already selected "
                    f"[app.func.{dep_function_id}.examples.{existing}] as its canonical JSON test example."
                )

    return selected


def build_autotest_cases(
    selected_order: list[str],
    function_index: dict[str, dict[str, Any]],
    selected_examples: dict[str, str],
    selected_dependency_map: dict[str, set[str]],
    *,
    package_name: str,
) -> list[dict[str, Any]]:
    hook_example_keys = {
        dependency_key
        for dependency_keys in selected_dependency_map.values()
        for dependency_key in dependency_keys
    }
    selected_state_refs = {
        function_id: function_output_key(function_index[function_id])
        for function_id in selected_examples
    }

    cases: list[dict[str, Any]] = []
    for current_key in selected_order:
        function_id, example_name = current_key.split("::", 1)
        func = function_index[function_id]
        example = example_by_name(func, example_name)
        output_key = function_output_key(func)
        dependency_keys = sorted(
            selected_dependency_map.get(current_key, set()),
            key=example_key_sort_key(function_index),
        )
        dependency_targets = [
            function_target_expr(function_index[dependency_key.split("::", 1)[0]])
            for dependency_key in dependency_keys
        ]
        kwargs_expr = render_kwargs_dict(
            example,
            base_lookup=lambda source_function_id, _source_example_name=None: f"ctx.state[{selected_state_refs[source_function_id]!r}]",
            context_ref="ctx.api",
            current_example_label=example_label_for(func, example),
        )
        hook_code = render_hook_code(func, output_key) if current_key in hook_example_keys else ""
        provider_code = render_provider_code(
            func,
            example,
            kwargs_expr,
            dependency_targets,
            current_example_label=example_label_for(func, example),
        )
        cases.append(
            {
                "function_id": function_id,
                "example_name": example_name,
                "function_name": func["name"],
                "function_label": function_display_name(func),
                "example_label": example_label_for(func, example),
                "output_key": output_key,
                "module": group_public_import_path(package_name, group_path_for_function(func)),
                "class_name": class_name_for_group(group_path_for_function(func)),
                "hook_code": hook_code,
                "provider_code": provider_code,
                "dependencies": dependency_targets,
            }
        )
    return cases


def build_manual_cases(
    project: dict[str, Any],
    function_index: dict[str, dict[str, Any]],
    test_dependencies: dict[str, set[str]],
    selected_json_examples: dict[str, str],
) -> list[dict[str, Any]]:
    selected_state_keys = {
        function_id: function_output_key(function_index[function_id])
        for function_id in selected_json_examples
    }

    manual_cases: list[dict[str, Any]] = []
    for func in project.get("functions", []):
        function_id = str(func["id"])
        for example in func.get("examples", []):
            if not bool(example.get("test")):
                continue

            example_label = example_label_for(func, example)
            example_type = normalize_example_type(example, example_label=example_label)
            if example_type == JSON_EXAMPLE_TYPE:
                continue

            key = example_key(function_id, str(example["name"]))
            dependency_keys = sorted(
                test_dependencies.get(key, set()),
                key=example_key_sort_key(function_index),
            )
            kwargs_expr = render_call_kwargs(
                example,
                base_lookup=lambda source_function_id, _source_example_name=None: selected_state_keys[source_function_id],
                context_ref="api",
                current_example_label=example_label,
            )
            manual_cases.append(
                {
                    "function_id": function_id,
                    "example_name": str(example["name"]),
                    "function_name": func["name"],
                    "function_label": function_display_name(func),
                    "example_label": example_label,
                    "type": example_type,
                    "dependencies": dependency_keys,
                    "call_path": build_readme_call_path(func),
                    "call_kwargs": kwargs_expr,
                    "code": render_manual_test_code(
                        func,
                        example,
                        example_type,
                        dependency_keys,
                        function_index,
                        selected_state_keys,
                        current_example_label=example_label,
                    ),
                }
            )
    return manual_cases


def build_fixture_cases(
    function_index: dict[str, dict[str, Any]],
    selected_json_examples: dict[str, str],
    test_dependencies: dict[str, set[str]],
    manual_cases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    selected_keys = {
        example_key(function_id, example_name)
        for function_id, example_name in selected_json_examples.items()
    }
    if not selected_keys:
        return []

    required_fixture_keys: set[str] = set()
    queue = deque()
    for case in manual_cases:
        for dependency_key in case["dependencies"]:
            if dependency_key not in selected_keys:
                dep_function_id, dep_example_name = dependency_key.split("::", 1)
                raise ValueError(
                    f"Manual test [app.func.{case['function_id']}.examples.{case['example_name']}] references "
                    f"[app.func.{dep_function_id}.examples.{dep_example_name}], but no canonical JSON test example was selected for that function."
                )
            if dependency_key not in required_fixture_keys:
                required_fixture_keys.add(dependency_key)
                queue.append(dependency_key)

    while queue:
        current_key = queue.popleft()
        for dependency_key in test_dependencies.get(current_key, set()):
            if dependency_key in selected_keys and dependency_key not in required_fixture_keys:
                required_fixture_keys.add(dependency_key)
                queue.append(dependency_key)

    if not required_fixture_keys:
        return []

    fixture_dependency_map = {
        key: {
            dependency_key
            for dependency_key in test_dependencies.get(key, set())
            if dependency_key in selected_keys
        }
        for key in required_fixture_keys
    }
    fixture_order = topological_example_order(required_fixture_keys, fixture_dependency_map, function_index)

    selected_state_keys = {
        function_id: function_output_key(function_index[function_id])
        for function_id in selected_json_examples
    }

    fixtures: list[dict[str, Any]] = []
    for current_key in fixture_order:
        function_id, example_name = current_key.split("::", 1)
        func = function_index[function_id]
        example = example_by_name(func, example_name)
        dependency_keys = sorted(
            fixture_dependency_map.get(current_key, set()),
            key=example_key_sort_key(function_index),
        )
        dependency_names = [
            function_output_key(function_index[dependency_key.split("::", 1)[0]])
            for dependency_key in dependency_keys
        ]
        kwargs_expr = render_call_kwargs(
            example,
            base_lookup=lambda source_function_id, _source_example_name=None: selected_state_keys[source_function_id],
            context_ref="api",
            current_example_label=example_label_for(func, example),
        )
        fixture_name = function_output_key(func)
        fixtures.append(
            {
                "name": fixture_name,
                "dependencies": dependency_names,
                "call_path": build_readme_call_path(func),
                "call_kwargs": kwargs_expr,
                "code": render_fixture_code(
                    fixture_name,
                    func,
                    example,
                    dependency_names,
                    kwargs_expr,
                    current_example_label=example_label_for(func, example),
                ),
            }
        )
    return fixtures


def build_test_import_map(autotest_cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    modules: dict[str, set[str]] = defaultdict(set)
    for case in autotest_cases:
        if not case["provider_code"] and not case["hook_code"]:
            continue
        modules[case["module"]].add(case["class_name"])

    return [
        {"module": module, "class_name": class_name}
        for module, class_name in sorted(
            ((module, class_name) for module, class_names in modules.items() for class_name in sorted(class_names)),
            key=lambda item: (item[0], item[1]),
        )
    ]


def render_hook_code(func: dict[str, Any], output_key: str) -> str:
    target = function_target_expr(func)
    lines = [
        f"@autotest_hook(target={target})",
        f"def _capture_{output_key}(resp, data, ctx: AutotestContext) -> None:",
        "    del resp",
        f"    ctx.state[{output_key!r}] = data",
    ]
    return "\n".join(lines)


def render_provider_code(
    func: dict[str, Any],
    example: dict[str, Any],
    kwargs_expr: str,
    dependency_targets: list[str],
    *,
    current_example_label: str,
) -> str:
    lines: list[str] = []
    for dependency_target in dependency_targets:
        lines.append(f"@autotest_depends_on({dependency_target})")
    lines.append(f"@autotest_params(target={function_target_expr(func)})")
    lines.append(f"def _params_{function_output_key(func)}(ctx: AutotestCallContext) -> dict[str, object]:")
    lines.extend(
        [
            "    try:",
            f"        return {kwargs_expr}",
            "    except Exception as exc:",
            f'        pytest.fail(f"{current_example_label} could not derive test parameters: {{exc}}")',
        ]
    )
    return "\n".join(lines)


def render_fixture_code(
    fixture_name: str,
    func: dict[str, Any],
    example: dict[str, Any],
    dependency_names: list[str],
    kwargs_expr: str,
    *,
    current_example_label: str,
) -> str:
    signature = "api"
    if dependency_names:
        signature += ", " + ", ".join(dependency_names)
    call_expr = f"{build_readme_call_path(func)}({kwargs_expr})" if kwargs_expr != "{}" else f"{build_readme_call_path(func)}()"
    lines = [
        "@pytest.fixture(scope=\"session\")",
        f"async def {fixture_name}({signature}):",
    ]
    if example.get("description"):
        description = escape_docstring(str(example.get("description")))
        lines.append(f'    """{description}"""')
    lines.extend(
        [
            f"    resp = await {call_expr}",
            "    data = resp.json()",
            "    return data",
        ]
    )
    return "\n".join(lines)


def render_manual_test_code(
    func: dict[str, Any],
    example: dict[str, Any],
    example_type: str,
    dependency_keys: list[str],
    function_index: dict[str, dict[str, Any]],
    selected_state_keys: dict[str, str],
    *,
    current_example_label: str,
) -> str:
    dependency_names = [
        function_output_key(function_index[dependency_key.split("::", 1)[0]])
        for dependency_key in dependency_keys
    ]
    signature = "api"
    if dependency_names:
        signature += ", " + ", ".join(dependency_names)
    if example_type == "text":
        signature += ", schemashot"

    call_kwargs = render_call_kwargs(
        example,
        base_lookup=lambda source_function_id, _source_example_name=None: selected_state_keys[source_function_id],
        context_ref="api",
        current_example_label=current_example_label,
    )
    call_expr = f"{build_readme_call_path(func)}({call_kwargs})" if call_kwargs else f"{build_readme_call_path(func)}()"
    example_name = str(example.get("name") or "example")
    snapshot_name = f"{class_name_for_group(group_path_for_function(func))}.{func['name']}"
    if example_name != str(func["name"]):
        snapshot_name = f"{snapshot_name}.{example_name}"
    base_name = snake_case(snapshot_name)
    test_name = f"test_{base_name}"

    lines = [f"async def {test_name}({signature}):"]
    if example.get("description"):
        description = escape_docstring(str(example.get("description")))
        lines.append(f'    """{description}"""')
    lines.append(f"    response = await {call_expr}")
    if example_type == "image":
        lines.extend(
            [
                "    image = response.image()",
                "    assert image.size[0] > 0",
                "    assert image.size[1] > 0",
                "    assert image.format is not None",
            ]
        )
    elif example_type == "text":
        lines.extend(
            [
                "    text = response.text",
                "    assert isinstance(text, str)",
                f"    schemashot.assert_json_match(text, {snapshot_name!r})",
            ]
        )
    else:
        raise ValueError(
            f"Manual test generation only supports text and image examples, got {example_type!r} for {current_example_label}."
        )
    return "\n".join(lines)


def build_autotest_data_cases(project: dict[str, Any]) -> list[dict[str, Any]]:
    warmup = project.get("warmup") or {}
    if not bool(warmup.get("headers_sniffer", False)):
        return []

    return [
        {
            "name": "unstandard_headers",
            "code": "\n".join(
                [
                    '@autotest_data(name="unstandard_headers")',
                    "def _unstandard_headers_data(ctx: AutotestDataContext) -> dict[str, object]:",
                    "    return ctx.api.unstandard_headers",
                ]
            ),
        },
        {
            "name": "unstandard_urls",
            "code": "\n".join(
                [
                    '@autotest_data(name="unstandard_urls")',
                    "def _unstandard_urls_data(ctx: AutotestDataContext) -> dict[str, object]:",
                    "    return ctx.api.unstandard_urls",
                ]
            ),
        },
    ]


def render_kwargs_dict(
    example: dict[str, Any],
    base_lookup: Callable[[str, str | None], str],
    *,
    context_ref: str,
    current_example_label: str,
) -> str:
    items = render_example_input_items(
        example,
        base_lookup,
        context_ref=context_ref,
        current_example_label=current_example_label,
        mapping_style="dict",
    )
    if not items:
        return "{}"
    return "{" + ", ".join(items) + "}"


def render_call_kwargs(
    example: dict[str, Any],
    base_lookup: Callable[[str, str | None], str],
    *,
    context_ref: str,
    current_example_label: str,
) -> str:
    items = render_example_input_items(
        example,
        base_lookup,
        context_ref=context_ref,
        current_example_label=current_example_label,
    )
    return ", ".join(items)


def render_example_input_items(
    example: dict[str, Any],
    base_lookup: Callable[[str, str | None], str],
    *,
    context_ref: str,
    current_example_label: str,
    mapping_style: str = "call",
) -> list[str]:
    inputs_expr = example_inputs_expr(example, current_example_label=current_example_label)
    if inputs_expr is None:
        return []
    rendered_items: list[str] = []
    for item in inputs_expr.get("items", []):
        rendered_value = render_test_expr(
            item["value"],
            base_lookup,
            context_ref=context_ref,
            current_example_label=current_example_label,
        )
        if mapping_style == "dict":
            rendered_items.append(f"{repr(item['key'])}: {rendered_value}")
            continue
        if mapping_style == "call":
            rendered_items.append(f"{item['key']}={rendered_value}")
            continue
        raise ValueError(
            f"Unsupported mapping style {mapping_style!r} while rendering {current_example_label}."
        )
    return rendered_items


def render_test_expr(
    expr: Any,
    base_lookup: Callable[[str, str | None], str],
    *,
    context_ref: str,
    current_example_label: str,
) -> str:
    if expr is None:
        return "None"
    if not isinstance(expr, dict):
        return render_expr(expr, self_ref=context_ref)

    kind = expr.get("kind")
    if kind == "ref":
        parts = expr.get("parts", [])
        if parts and parts[0].get("kind") == "name":
            root = str(parts[0].get("value"))
            if root == "INPUT":
                raise ValueError(
                    f"Example {current_example_label} contains an INPUT reference inside example inputs, which generated tests do not support."
                )
            if root == "FUNCRESULT":
                function_id, source_example_name, result_kind, _tail_parts = parse_funcresult_reference(expr)
                if result_kind != "JSON":
                    raise ValueError(
                        f"Example {current_example_label} references FUNCRESULT.{function_id}.{source_example_name}.{result_kind}, "
                        "but generated tests only support JSON source examples."
                    )
                try:
                    base_expr = base_lookup(function_id, source_example_name)
                except KeyError as exc:
                    raise ValueError(
                        f"Example {current_example_label} references missing source example "
                        f"[app.func.{function_id}.examples.{source_example_name}]."
                    ) from exc
                return render_funcresult_reference(expr, base_expr, index_self_ref=context_ref)
        return render_expr(expr, self_ref=context_ref)

    if kind in {"string", "number", "bool", "null"}:
        return render_expr(expr, self_ref=context_ref)
    if kind == "array":
        return "[" + ", ".join(
            render_test_expr(item, base_lookup, context_ref=context_ref, current_example_label=current_example_label)
            for item in expr.get("items", [])
        ) + "]"
    if kind == "inline_table":
        return "{" + ", ".join(
            f"{repr(item['key'])}: {render_test_expr(item['value'], base_lookup, context_ref=context_ref, current_example_label=current_example_label)}"
            for item in expr.get("items", [])
        ) + "}"
    if kind == "sequence":
        return " + ".join(
            render_test_expr(item, base_lookup, context_ref=context_ref, current_example_label=current_example_label)
            for item in expr.get("items", [])
        )
    if kind == "merge":
        parts = expr.get("parts", [])
        inline = next((part for part in parts if isinstance(part, dict) and part.get("kind") == "inline_table"), None)
        if inline is not None:
            other_parts = [part for part in parts if part is not inline]
            rendered = [render_test_expr(inline, base_lookup, context_ref=context_ref, current_example_label=current_example_label)] + [
                render_test_expr(item, base_lookup, context_ref=context_ref, current_example_label=current_example_label)
                for item in other_parts
            ]
            return " | ".join(rendered)
        return " + ".join(
            render_test_expr(item, base_lookup, context_ref=context_ref, current_example_label=current_example_label)
            for item in parts
        )
    if kind == "call":
        callee = render_test_expr(expr.get("callee"), base_lookup, context_ref=context_ref, current_example_label=current_example_label)
        args = ", ".join(
            f"{arg['name']}={render_test_expr(arg['value'], base_lookup, context_ref=context_ref, current_example_label=current_example_label)}"
            for arg in expr.get("args", [])
        )
        return f"{callee}({args})"
    if kind == "index":
        return (
            f"{render_test_expr(expr.get('value'), base_lookup, context_ref=context_ref, current_example_label=current_example_label)}"
            f"[{render_test_expr(expr.get('index'), base_lookup, context_ref=context_ref, current_example_label=current_example_label)}]"
        )

    raise ValueError(
        f"Example {current_example_label} uses unsupported expression kind {kind!r} inside test inputs."
    )


def collect_example_dependencies(
    example: dict[str, Any],
    function_index: dict[str, dict[str, Any]],
    *,
    current_example_label: str,
) -> set[str]:
    inputs = example_inputs_expr(example, current_example_label=current_example_label)
    if inputs is None:
        return set()

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
            if parts and parts[0].get("kind") == "name":
                root = str(parts[0].get("value"))
                if root == "INPUT":
                    raise ValueError(
                        f"Example {current_example_label} contains an INPUT reference inside example inputs, which generated tests do not support."
                    )
                if root == "FUNCRESULT":
                    function_id, source_example_name, result_kind, _tail_parts = parse_funcresult_reference(node)
                    if result_kind != "JSON":
                        raise ValueError(
                            f"Example {current_example_label} references FUNCRESULT.{function_id}.{source_example_name}.{result_kind}, "
                            "but generated tests only support JSON source examples."
                        )
                    source_func = function_index.get(function_id)
                    if source_func is None:
                        raise ValueError(
                            f"Example {current_example_label} references missing source example "
                            f"[app.func.{function_id}.examples.{source_example_name}]."
                        )
                    source_example = example_by_name(source_func, source_example_name)
                    source_label = example_label_for(source_func, source_example)
                    if not bool(source_example.get("test")):
                        raise ValueError(
                            f"Example {current_example_label} references {source_label}, but the referenced example is not marked @Test."
                        )
                    if normalize_example_type(source_example, example_label=source_label) != JSON_EXAMPLE_TYPE:
                        raise ValueError(
                            f"Example {current_example_label} references {source_label}, but generated tests only support JSON source examples."
                        )
                    dependencies.add(example_key(function_id, source_example_name))
            for part in parts:
                walk(part.get("value"))
            return
        if kind == "inline_table":
            for item in node.get("items", []):
                walk(item.get("value"))
            return
        if kind in {"array", "sequence"}:
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
        if kind in {"string", "number", "bool", "null"}:
            return
        raise ValueError(
            f"Example {current_example_label} uses unsupported expression kind {kind!r} inside test inputs."
        )

    walk(inputs)
    return dependencies


def topological_example_order(
    keys: set[str],
    dependency_map: dict[str, set[str]],
    function_index: dict[str, dict[str, Any]],
) -> list[str]:
    if not keys:
        return []

    order_index = example_order_index(function_index)
    pending = {
        key: {dependency for dependency in dependency_map.get(key, set()) if dependency in keys and dependency != key}
        for key in keys
    }
    dependents: dict[str, set[str]] = {key: set() for key in keys}
    for key, dependencies in pending.items():
        for dependency in dependencies:
            dependents.setdefault(dependency, set()).add(key)

    ready = sorted(
        [key for key, dependencies in pending.items() if not dependencies],
        key=lambda item: order_index.get(item, (9999, 9999)),
    )
    ordered: list[str] = []
    while ready:
        current = ready.pop(0)
        ordered.append(current)
        for dependent in sorted(
            dependents.get(current, set()),
            key=lambda item: order_index.get(item, (9999, 9999)),
        ):
            child_deps = pending.get(dependent)
            if child_deps is None:
                continue
            child_deps.discard(current)
            if not child_deps and dependent not in ordered and dependent not in ready:
                ready.append(dependent)
                ready.sort(key=lambda item: order_index.get(item, (9999, 9999)))

    if len(ordered) != len(keys):
        unresolved = [key for key in keys if key not in ordered]
        raise ValueError(
            "Generated tests detected a dependency cycle among examples: "
            + ", ".join(example_label_from_key(key) for key in unresolved)
        )

    return ordered


def example_order_index(function_index: dict[str, dict[str, Any]]) -> dict[str, tuple[int, int]]:
    order: dict[str, tuple[int, int]] = {}
    for function_index_position, (function_id, func) in enumerate(function_index.items()):
        for example_index_position, example in enumerate(func.get("examples", [])):
            order[example_key(function_id, str(example.get("name") or ""))] = (function_index_position, example_index_position)
    return order


def example_key_sort_key(function_index: dict[str, dict[str, Any]]) -> Callable[[str], tuple[int, int]]:
    order_index = example_order_index(function_index)
    return lambda key: order_index.get(key, (9999, 9999))


def function_output_key(func: dict[str, Any]) -> str:
    return f"{snake_case(function_display_name(func))}_json"


def function_target_expr(func: dict[str, Any]) -> str:
    return f"{class_name_for_group(group_path_for_function(func))}.{func['name']}"


def function_display_name(func: dict[str, Any]) -> str:
    return f"{group_name_for_function(func)}.{func['name']}"


def group_name_for_function(func: dict[str, Any]) -> str:
    group = str(func.get("group") or "").strip()
    return group or "MSRA"


def group_path_for_function(func: dict[str, Any]) -> list[str]:
    group = str(func.get("group") or "").strip()
    return [segment for segment in group.split(".") if segment]


def example_by_name(func: dict[str, Any], example_name: str) -> dict[str, Any]:
    for example in func.get("examples", []):
        if str(example.get("name")) == example_name:
            return example
    raise ValueError(f"Could not find example [app.func.{func['id']}.examples.{example_name}].")


def example_key(function_id: str, example_name: str) -> str:
    return f"{function_id}::{example_name}"


def example_label_for(func: dict[str, Any], example: dict[str, Any]) -> str:
    return f"[app.func.{func['id']}.examples.{example['name']}]"


def example_label_from_key(key: str) -> str:
    function_id, example_name = key.split("::", 1)
    return f"[app.func.{function_id}.examples.{example_name}]"


def normalize_example_type(example: dict[str, Any] | None, *, example_label: str) -> str:
    if not example:
        return JSON_EXAMPLE_TYPE
    value = str(example.get("type") or JSON_EXAMPLE_TYPE).strip().lower()
    if value not in SUPPORTED_TEST_EXAMPLE_TYPES:
        raise ValueError(
            f"Example {example_label} uses unsupported test example type {value!r}. "
            f"Supported types are: {', '.join(sorted(SUPPORTED_TEST_EXAMPLE_TYPES))}."
        )
    return value


def example_inputs_expr(example: dict[str, Any], *, current_example_label: str) -> dict[str, Any] | None:
    inputs = example.get("inputs")
    if inputs is None:
        return None
    if not isinstance(inputs, dict) or inputs.get("kind") != "inline_table":
        raise ValueError(
            f"Example {current_example_label} must use an inline table for inputs to generate tests."
        )
    return inputs


def escape_docstring(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"""', '\\"""')
