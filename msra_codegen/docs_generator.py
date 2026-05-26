from __future__ import annotations

import shutil
import textwrap
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import quote

from .codegen_context import abstraction_exports, build_group_context
from .core_naming import group_public_import_path, root_client_class_name
from .file_utils import write_text
from .generator_config import config_section
from .project_model import top_level_groups
from .readme_pipeline import build_readme_pipeline_code, build_readme_pipeline_note
from .template_engine import render_template


def generate_docs_project(
    project: dict[str, Any],
    output_dir: Path,
    package_name: str,
    group_tree: dict[str, Any],
    *,
    tests_context: dict[str, Any] | None = None,
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

    context = build_docs_project_context(project, package_name, group_tree, tests_context=tests_context)

    write_text(
        output_dir / "README.md",
        render_template("README.md.tpl", context),
    )
    write_text(
        output_dir / "example.py",
        render_template("example.py.tpl", context),
    )
    stale_examples_dir = output_dir / "examples"
    if stale_examples_dir.exists():
        shutil.rmtree(stale_examples_dir)
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
    *,
    tests_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    app = project["app"]
    docs_descriptions = config_section("docs", "descriptions")
    client_class_name = root_client_class_name(project)
    exports = list(dict.fromkeys([client_class_name, "Warmup", *abstraction_exports(project)]))
    top_groups = [
        build_group_docs_context(group_node, project, package_name)
        for group_node in top_level_groups(group_tree)
    ]
    project_title = str(app["name"] or package_name)
    index_title = f"{project_title} documentation"
    pipeline_script_code = build_readme_pipeline_code(project, package_name, client_class_name)
    readme_context = build_readme_context(project, package_name, pipeline_script_code)
    return {
        "title": index_title,
        "title_underline": "=" * len(index_title),
        "project_name": project_title,
        "project_version": str(app["version"]),
        "package_name": package_name,
        "browser": str(app.get("browser", "")),
        "client_class_name": client_class_name,
        "has_catalog_sort": "CatalogSort" in exports,
        "current_year": str(date.today().year),
        "root_package": build_module_page_context(
            title=package_name,
            import_path=package_name,
            description=str(app.get("description") or ""),
            class_names=exports,
            child_pages=[],
        ),
        "manager_module": build_module_page_context(
            title=f"{package_name}.manager",
            import_path=f"{package_name}.manager",
            description=str(docs_descriptions.get("manager") or ""),
            class_names=[client_class_name, "Warmup"],
            child_pages=[],
        ),
        "endpoints_module": build_module_page_context(
            title=f"{package_name}.endpoints",
            import_path=f"{package_name}.endpoints",
            description=str(docs_descriptions.get("endpoints") or ""),
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
            "requires_camoufox": str(app.get("browser", "")) == "camoufox",
            "top_groups": top_groups,
        },
        "tests": build_readme_tests_context(project, package_name, tests_context),
        "readme": readme_context,
        "pipeline_script_code": pipeline_script_code,
        "pipeline_script_code_rst": textwrap.indent(pipeline_script_code, "    "),
        "pipeline_note": build_readme_pipeline_note(project),
    }


def build_readme_context(
    project: dict[str, Any],
    package_name: str,
    pipeline_script_code: str,
) -> dict[str, Any]:
    app = project["app"]
    readme_config = config_section("readme")
    package_owner = str(app.get("package_owner") or package_name).strip() or package_name
    package_owner_lower = package_owner.lower()
    package_name_slug = package_name.replace("_", "-")
    repo_url = f"https://github.com/{package_owner}/{package_name}"
    docs_url = f"https://{package_owner_lower}.github.io/{package_name}/quick_start"
    workflow_url = f"{repo_url}/actions/workflows/tests.yml"
    workflow_runs_url = f"https://api.github.com/repos/{package_owner}/{package_name}/actions/workflows/tests.yml/runs?per_page=1&status=completed"
    display_title = str(app.get("name") or package_name).strip() or package_name
    description = str(app.get("description") or "").strip()
    socials = build_readme_social_links(app.get("social"))
    return {
        "title": display_title,
        "project_line": display_title,
        "description": description,
        "package_owner": package_owner,
        "package_owner_lower": package_owner_lower,
        "package_name": package_name,
        "package_name_slug": package_name_slug,
        "repo_url": repo_url,
        "issues_url": f"{repo_url}/issues",
        "docs_url": docs_url,
        "workflow_url": workflow_url,
        "workflow_badge_url": f"{workflow_url}/badge.svg",
        "workflow_last_run_badge_url": (
            "https://img.shields.io/badge/dynamic/json?label=Tests%20last%20run"
            "&query=%24.workflow_runs%5B0%5D.updated_at"
            f"&url={quote(workflow_runs_url, safe='')}"
            "&logo=githubactions&cacheSeconds=300"
        ),
        "pypi_project_url": f"https://pypi.org/project/{package_name_slug}/",
        "pypi_python_badge_url": f"https://img.shields.io/pypi/pyversions/{package_name}",
        "pypi_version_badge_url": f"https://img.shields.io/pypi/v/{package_name}?color=blue",
        "pypi_downloads_badge_url": f"https://img.shields.io/pypi/dm/{package_name}?label=PyPi%20downloads",
        "license_badge_url": f"https://img.shields.io/github/license/{package_owner}/{package_name}",
        "license_url": f"{repo_url}/blob/main/LICENSE",
        "socials": socials,
        "principle_text": str(readme_config.get("principle_text", "Библиотека полностью повторяет сетевую работу обычного пользователя на сайте.")),
        "pipeline_script_code": pipeline_script_code,
    }


def build_readme_tests_context(
    project: dict[str, Any],
    package_name: str,
    tests_context: dict[str, Any] | None,
) -> dict[str, Any]:
    client_class_name = root_client_class_name(project)
    has_autotests = False
    if isinstance(tests_context, dict):
        api_test = tests_context.get("api_test")
        if isinstance(api_test, dict):
            has_autotests = any(bool(api_test.get(key)) for key in ("hooks", "providers", "manual_tests", "data_cases"))
    return {
        "has_autotests": has_autotests,
        "autotest_start_class": f"{package_name}.{client_class_name}",
    }


def build_readme_social_links(social: Any) -> list[dict[str, Any]]:
    if not isinstance(social, dict):
        return []
    readme_socials = config_section("readme").get("socials", [])
    links: list[dict[str, Any]] = []
    if not isinstance(readme_socials, list):
        return links
    for item in readme_socials:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        if not key:
            continue
        url = str(social.get(key) or "").strip()
        if not url:
            continue
        badge_url = str(item.get("badge_url", "")).strip()
        if not badge_url:
            continue
        links.append(
            {
                "key": key,
                "label": str(item.get("label", key.title())),
                "badge_url": badge_url,
                "url": url,
            }
        )
    return links


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
