from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from .file_utils import write_text
from .template_engine import render_template


def build_github_issue_templates_context(project: dict[str, Any]) -> dict[str, Any] | None:
    app = project.get("app", {})
    issue_templates = app.get("issue_templates")
    if issue_templates is None:
        return None
    if not isinstance(issue_templates, dict):
        raise RuntimeError("app.issue_templates must be a table.")

    assignee = str(issue_templates.get("assignee", "")).strip()
    if not assignee:
        raise RuntimeError("app.issue_templates.assignee must be a non-empty string.")

    contact_links = build_issue_template_contact_links(app)

    return {
        "assignee": assignee,
        "contact_links": contact_links,
        "yaml_value": lambda value: json.dumps(value, ensure_ascii=False),
    }


def build_issue_template_contact_links(app: dict[str, Any]) -> list[dict[str, str]]:
    package_owner = str(app.get("package_owner", "")).strip()
    package_name = str(app.get("package_name", "")).strip()
    if not package_owner or not package_name:
        raise RuntimeError("app.package_owner and app.package_name are required to generate issue templates.")

    contact_links: list[dict[str, str]] = [
        {
            "name": "📖  Read the docs",
            "url": f"https://{package_owner.lower()}.github.io/{package_name}/quick_start.html",
            "about": "Start here for “how-to” questions.",
        }
    ]

    social = app.get("social")
    if social is None:
        return contact_links
    if not isinstance(social, dict):
        raise RuntimeError("app.social must be a table when issue templates are enabled.")

    discord_url = str(social.get("discord", "")).strip()
    if discord_url:
        contact_links.append(
            {
                "name": "💬  Discord server (Discussions)",
                "url": discord_url,
                "about": "General Q&A and community support.",
            }
        )

    telegram_url = str(social.get("telegram", "")).strip()
    if telegram_url:
        contact_links.append(
            {
                "name": "💬  Telegram channel (Discussions)",
                "url": telegram_url,
                "about": "General Q&A and community support.",
            }
        )

    return contact_links


def generate_github_issue_templates_project(project: dict[str, Any], output_dir: Path) -> None:
    issue_templates_root = output_dir / ".github" / "ISSUE_TEMPLATE"
    context = build_github_issue_templates_context(project)
    if issue_templates_root.exists():
        shutil.rmtree(issue_templates_root)
    if context is None:
        return

    issue_templates_root.mkdir(parents=True, exist_ok=True)
    write_text(
        issue_templates_root / "config.yml",
        render_template("github/issue_templates/config.yml.tpl", context),
    )
    write_text(
        issue_templates_root / "bug_report.yml",
        render_template("github/issue_templates/bug_report.yml.tpl", context),
    )
    write_text(
        issue_templates_root / "documentation_issue.yml",
        render_template("github/issue_templates/documentation_issue.yml.tpl", context),
    )
    write_text(
        issue_templates_root / "feature_request.yml",
        render_template("github/issue_templates/feature_request.yml.tpl", context),
    )
