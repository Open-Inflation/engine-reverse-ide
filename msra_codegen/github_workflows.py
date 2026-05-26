from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from .file_utils import write_text
from .generator_config import config_section
from .template_engine import render_template


def build_github_workflows_context(project: dict[str, Any], package_name: str) -> dict[str, Any]:
    github_config = config_section("github", "workflows")
    tests_config = github_config["tests"]
    publish_config = github_config["publish"]
    package_name_slug = package_name.replace("_", "-")

    tests_python_version = str(tests_config["python_version"])
    publish_python_version = str(publish_config["python_version"])

    return {
        "package_name": package_name,
        "package_name_slug": package_name_slug,
        "tests": {
            "name": str(tests_config["name"]),
            "schedule_cron": str(tests_config["schedule_cron"]),
            "runner": list(tests_config["runner"]),
            "python_version": tests_python_version,
            "python_version_expr": "${{ inputs.python-version || '" + tests_python_version + "' }}",
            "checkout_action": str(tests_config["checkout_action"]),
            "setup_python_action": str(tests_config["setup_python_action"]),
            "install_commands": list(tests_config["install_commands"]),
            "run_commands": list(tests_config["run_commands"]),
            "report_playwright_failure_action": str(tests_config["report_playwright_failure_action"]),
            "report_schema_action": str(tests_config["report_schema_action"]),
            "github_token_expr": "${{ secrets." + str(tests_config["github_token_secret"]) + " }}",
            "concurrency_group": str(tests_config["name"]) + "-${{ github.ref }}",
            "log_path": str(tests_config["log_path"]),
            "screenshot_path": str(tests_config["screenshot_path"]),
        },
        "publish": {
            "name": str(publish_config["name"]),
            "python_version": publish_python_version,
            "checkout_action": str(publish_config["checkout_action"]),
            "setup_python_action": str(publish_config["setup_python_action"]),
            "setup_python_cache": str(publish_config["setup_python_cache"]),
            "workflow_tests_path": "./.github/workflows/tests.yml",
            "concurrency_group": str(publish_config["name"]) + "-${{ github.ref }}",
            "docs_condition_expr": "${{ github.event.inputs.target == 'docs' || github.event.inputs.target == 'all' }}",
            "package_condition_expr": "${{ github.event.inputs.target == 'package' || github.event.inputs.target == 'all' }}",
            "upload_pages_action": str(publish_config["upload_pages_action"]),
            "deploy_pages_action": str(publish_config["deploy_pages_action"]),
            "pypi_action": str(publish_config["pypi_action"]),
            "target_options": list(publish_config["target_options"]),
            "pages_environment_name": str(publish_config["pages_environment_name"]),
            "pypi_environment_name": str(publish_config["pypi_environment_name"]),
            "github_token_expr": "${{ secrets." + str(publish_config["github_token_secret"]) + " }}",
            "page_url_expr": "${{ steps.deployment.outputs.page_url }}",
            "pypi_url": f"https://pypi.org/project/{package_name_slug}/",
        },
        "makefile": {
            "package_name": package_name,
        },
    }


def generate_github_workflows_project(project: dict[str, Any], output_dir: Path, package_name: str) -> None:
    context = build_github_workflows_context(project, package_name)
    workflows_root = output_dir / ".github" / "workflows"
    if workflows_root.exists():
        shutil.rmtree(workflows_root)
    workflows_root.mkdir(parents=True, exist_ok=True)

    write_text(
        output_dir / "Makefile",
        render_template("Makefile.tpl", context["makefile"]),
    )
    write_text(
        workflows_root / "tests.yml",
        render_template("github/workflows/tests.yml.tpl", context),
    )
    write_text(
        workflows_root / "publish.yml",
        render_template("github/workflows/publish.yml.tpl", context),
    )
