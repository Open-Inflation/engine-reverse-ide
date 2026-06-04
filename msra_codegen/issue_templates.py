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
    if not issue_templates:
        return None
    if not isinstance(issue_templates, dict):
        raise RuntimeError("app.issue_templates must be a table.")

    blank_issues_enabled = issue_templates.get("blank_issues_enabled")
    if not isinstance(blank_issues_enabled, bool):
        raise RuntimeError("app.issue_templates.blank_issues_enabled must be a boolean.")

    assignee = str(issue_templates.get("assignee", "")).strip()
    if not assignee:
        raise RuntimeError("app.issue_templates.assignee must be a non-empty string.")

    contact_links = issue_templates.get("contact_links")
    if not isinstance(contact_links, list) or not contact_links:
        raise RuntimeError("app.issue_templates.contact_links must be a non-empty list.")

    normalized_contact_links: list[dict[str, str]] = []
    for index, link in enumerate(contact_links):
        if not isinstance(link, dict):
            raise RuntimeError(f"app.issue_templates.contact_links[{index}] must be a table.")
        name = str(link.get("name", "")).strip()
        url = str(link.get("url", "")).strip()
        about = str(link.get("about", "")).strip()
        if not name or not url or not about:
            raise RuntimeError(f"app.issue_templates.contact_links[{index}] must define name, url, and about.")
        normalized_contact_links.append(
            {
                "name": name,
                "url": url,
                "about": about,
            }
        )

    templates: dict[str, dict[str, Any]] = {}
    for template_name in ("bug_report", "documentation_issue", "feature_request"):
        template_value = issue_templates.get(template_name)
        if not isinstance(template_value, dict):
            raise RuntimeError(f"app.issue_templates.{template_name} must be a table.")

        name = str(template_value.get("name", "")).strip()
        description = str(template_value.get("description", "")).strip()
        title = str(template_value.get("title", "")).strip()
        labels = template_value.get("labels")
        if not isinstance(labels, list) or not labels:
            raise RuntimeError(f"app.issue_templates.{template_name}.labels must be a non-empty list.")
        normalized_labels: list[str] = []
        for index, label in enumerate(labels):
            text = str(label).strip()
            if not text:
                raise RuntimeError(f"app.issue_templates.{template_name}.labels[{index}] must be a non-empty string.")
            normalized_labels.append(text)
        if not name or not description or not title:
            raise RuntimeError(f"app.issue_templates.{template_name} must define name, description, and title.")

        templates[template_name] = {
            "name": name,
            "description": description,
            "title": title,
            "labels": normalized_labels,
        }

    return {
        "blank_issues_enabled": blank_issues_enabled,
        "assignee": assignee,
        "contact_links": normalized_contact_links,
        "yaml_value": lambda value: json.dumps(value, ensure_ascii=False),
        **templates,
    }


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
