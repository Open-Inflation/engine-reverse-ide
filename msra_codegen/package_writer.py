from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .codegen_context import (
    build_abstraction_package_context,
    collect_extractor_scripts,
    collect_goto_pipeline_scripts,
    collect_warmup_scripts,
    render_endpoints_init,
    render_init,
    render_manager_template,
    write_group_package,
)
from .github_workflows import generate_github_workflows_project
from .core_naming import normalize_script_path
from .file_utils import write_text
from .package_metadata import render_pyproject, render_requirements_dev_txt, render_requirements_txt, write_root_license
from .project_model import build_group_tree, top_level_groups
from .tests_generator import build_tests_project_context, generate_tests_project
from .template_engine import render_template


def ensure_package_inits(target_dir: Path, package_root: Path) -> None:
    current = target_dir
    while current != package_root and package_root in current.parents:
        init_file = current / "__init__.py"
        if not init_file.exists():
            write_text(init_file, "")
        current = current.parent


def generate_project(
    project: dict[str, Any],
    output_dir: Path,
    source_root: Path | None = None,
) -> None:
    output_dir = output_dir.resolve()
    source_root = source_root.resolve() if source_root is not None else Path(project["source_path"]).resolve().parent
    package_name = str(project["app"].get("package_name") or "").strip()
    if not package_name:
        raise ValueError('app.package_name is required and must be set explicitly in the source MSRA file.')
    group_tree = build_group_tree(project)

    package_root = output_dir / package_name
    abstraction_root = package_root / "abstraction"
    endpoints_root = package_root / "endpoints"
    pipelines_root = package_root / "pipelines"
    legacy_postprocess_root = package_root / "postprocess"
    extractors_root = package_root / "extractors"
    package_root.mkdir(parents=True, exist_ok=True)
    abstraction_root.mkdir(parents=True, exist_ok=True)
    if pipelines_root.exists():
        shutil.rmtree(pipelines_root)
    pipelines_root.mkdir(parents=True, exist_ok=True)
    if legacy_postprocess_root.exists():
        shutil.rmtree(legacy_postprocess_root)
    if extractors_root.exists():
        shutil.rmtree(extractors_root)
    extractors_root.mkdir(parents=True, exist_ok=True)
    for stale_pipeline_file in [package_root / "warmup.py", package_root / "goto_pipeline.py"]:
        if stale_pipeline_file.exists():
            stale_pipeline_file.unlink()

    tests_context = build_tests_project_context(project, package_name)

    write_text(
        output_dir / "pyproject.toml",
        render_pyproject(project, package_name),
    )
    write_text(
        output_dir / "requirements.txt",
        render_requirements_txt(project),
    )
    write_text(
        output_dir / "requirements-dev.txt",
        render_requirements_dev_txt(project),
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
        write_group_package(
            group_node,
            project,
            package_name,
            endpoints_root,
            autotest_function_ids=tests_context["autotest_function_ids"],
        )

    for script in dict.fromkeys(collect_warmup_scripts(project) + collect_goto_pipeline_scripts(project)):
        source = source_root / script
        target = pipelines_root / normalize_script_path(script)
        target.parent.mkdir(parents=True, exist_ok=True)
        ensure_package_inits(target.parent, package_root)
        shutil.copyfile(source, target)

    for script in dict.fromkeys(collect_extractor_scripts(project)):
        source = source_root / script
        target = package_root / normalize_script_path(script)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)

    legacy_license_dir = output_dir / "LICENSES"
    if legacy_license_dir.exists():
        shutil.rmtree(legacy_license_dir)
    write_root_license(output_dir, project)
    generate_github_workflows_project(project, output_dir, package_name)

    from .docs_generator import generate_docs_project

    generate_docs_project(
        project,
        output_dir,
        package_name,
        group_tree,
        tests_context=tests_context,
    )
    generate_tests_project(
        project,
        output_dir,
        package_name,
        group_tree,
        tests_context=tests_context,
    )
