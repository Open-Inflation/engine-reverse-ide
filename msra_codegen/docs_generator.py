from __future__ import annotations

import shutil
from datetime import date
from pathlib import Path
from typing import Any

from .generator import (
    abstraction_exports,
    build_group_context,
    render_template,
    root_client_class_name,
    snake_case,
    top_level_groups,
    write_text,
)


def generate_docs_project(
    project: dict[str, Any],
    output_dir: Path,
    package_name: str,
    group_tree: dict[str, Any],
) -> None:
    docs_root = output_dir / "docs"
    if docs_root.exists():
        shutil.rmtree(docs_root)

    source_root = docs_root / "source"
    api_root = source_root / "_api"
    static_root = source_root / "_static"
    templates_root = source_root / "_templates"
    api_root.mkdir(parents=True, exist_ok=True)
    static_root.mkdir(parents=True, exist_ok=True)
    templates_root.mkdir(parents=True, exist_ok=True)

    context = build_docs_project_context(project, package_name, group_tree)

    write_text(
        docs_root / "requirements.txt",
        render_template("docs/requirements.txt.tpl", context),
    )
    write_text(
        source_root / "Makefile",
        render_template("docs/source/Makefile.tpl", context),
    )
    write_text(
        source_root / "conf.py",
        render_template("docs/source/conf.py.tpl", context),
    )
    write_text(
        source_root / "index.rst",
        render_template("docs/source/index.rst.tpl", context),
    )
    write_text(
        source_root / "quick_start.rst",
        render_template("docs/source/quick_start.rst.tpl", context),
    )
    write_text(
        source_root / "api.rst",
        render_template("docs/source/api.rst.tpl", context),
    )
    write_text(
        source_root / f"{package_name}.rst",
        render_template("docs/source/module.rst.tpl", context["root_package"]),
    )
    write_text(
        api_root / f"{package_name}.manager.rst",
        render_template("docs/source/module.rst.tpl", context["manager_module"]),
    )
    write_text(
        api_root / f"{package_name}.endpoints.rst",
        render_template("docs/source/module.rst.tpl", context["endpoints_module"]),
    )

    for group_node in top_level_groups(group_tree):
        write_group_docs(group_node, project, package_name, api_root)


def write_group_docs(
    group_node: dict[str, Any],
    project: dict[str, Any],
    package_name: str,
    api_root: Path,
) -> None:
    context = build_group_docs_context(group_node, project, package_name)
    write_text(
        api_root / f"{context['import_path']}.rst",
        render_template("docs/source/module.rst.tpl", context),
    )
    for child_node in group_node.get("children", {}).values():
        write_group_docs(child_node, project, package_name, api_root)


def build_docs_project_context(
    project: dict[str, Any],
    package_name: str,
    group_tree: dict[str, Any],
) -> dict[str, Any]:
    app = project["app"]
    client_class_name = root_client_class_name(project)
    exports = list(dict.fromkeys([client_class_name, *abstraction_exports(project)]))
    top_groups = [
        build_group_docs_context(group_node, project, package_name)
        for group_node in top_level_groups(group_tree)
    ]
    project_title = str(app["name"] or package_name)
    index_title = f"{project_title} documentation"
    return {
        "title": index_title,
        "title_underline": "=" * len(index_title),
        "project_name": project_title,
        "project_version": str(app["version"]),
        "package_name": package_name,
        "client_class_name": client_class_name,
        "has_catalog_sort": "CatalogSort" in exports,
        "current_year": str(date.today().year),
        "root_package": build_module_page_context(
            title=package_name,
            import_path=package_name,
            description=app.get("description") or f"Generated client package for {project_title}.",
            class_names=exports,
            child_pages=[],
        ),
        "manager_module": build_module_page_context(
            title=f"{package_name}.manager",
            import_path=f"{package_name}.manager",
            description=f"Generated client manager for {project_title}.",
            class_names=[client_class_name],
            child_pages=[],
        ),
        "endpoints_module": build_module_page_context(
            title=f"{package_name}.endpoints",
            import_path=f"{package_name}.endpoints",
            description="Generated endpoint package.",
            class_names=[group["class_name"] for group in top_groups],
            child_pages=[group["import_path"] for group in top_groups],
        ),
        "api_docnames": [f"_api/{package_name}.endpoints", f"_api/{package_name}.manager"],
        "top_groups": top_groups,
        "quick_start": {
            "title": "Quick Start",
            "title_underline": "=" * len("Quick Start"),
            "package_name": package_name,
            "client_class_name": client_class_name,
            "has_catalog_sort": "CatalogSort" in exports,
            "top_groups": top_groups,
        },
    }


def build_group_docs_context(
    group_node: dict[str, Any],
    project: dict[str, Any],
    package_name: str,
) -> dict[str, Any]:
    group_context = build_group_context(group_node, project, package_name)
    child_nodes = list(group_node.get("children", {}).values())
    child_class_names = [child["class_name"] for child in group_context["child_imports"]]
    class_names = [group_context["class_name"], *child_class_names]
    import_path = group_public_import_path(package_name, group_node.get("path", []))
    context = build_module_page_context(
        title=import_path,
        import_path=import_path,
        description=group_context["description"],
        class_names=list(dict.fromkeys(class_names)),
        child_pages=[group_public_import_path(package_name, child["path"]) for child in child_nodes],
    )
    context.update(
        {
            "class_name": group_context["class_name"],
            "child_class_names": list(dict.fromkeys(child_class_names)),
            "field_name": group_node["path"][-1] if group_node.get("path") else "Group",
        }
    )
    return context


def build_module_page_context(
    *,
    title: str,
    import_path: str,
    description: str,
    class_names: list[str],
    child_pages: list[str],
) -> dict[str, Any]:
    class_names = list(dict.fromkeys(class_names))
    child_pages = list(dict.fromkeys(child_pages))
    return {
        "title": title,
        "title_underline": "=" * len(title),
        "import_path": import_path,
        "description": description,
        "class_names": class_names,
        "class_refs": [f"{import_path}.{name}" for name in class_names],
        "child_pages": child_pages,
        "child_docnames": child_pages,
    }


def group_public_import_path(package_name: str, group_path: list[str]) -> str:
    segments = [snake_case(segment) for segment in group_path]
    if not segments:
        return f"{package_name}.endpoints"
    return ".".join([package_name, "endpoints", *segments])
