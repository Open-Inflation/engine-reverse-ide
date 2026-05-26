from __future__ import annotations

import json
import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.request import urlopen

from packaging.version import Version
from jinja2 import TemplateNotFound

from .core_naming import root_client_class_name
from .file_utils import write_text
from .template_engine import render_template


PYTHON_RELEASES_API_URL = "https://www.python.org/api/v2/downloads/release/"
PYTHON_RELEASES_API_TIMEOUT_SECONDS = 15.0


def render_pyproject(project: dict[str, Any], package_name: str) -> str:
    client_class_name = root_client_class_name(project)
    authors = project["app"].get("authors", [])
    min_required_python = str(project["app"].get("min_required_python", "3.10") or "3.10").strip()
    description = str(project["app"].get("description", "") or "").strip()
    return render_template(
        "pyproject.toml.tpl",
        {
            "authors_block": render_authors_block(authors),
            "description": json.dumps(description, ensure_ascii=False),
            "license": project["app"].get("license", "MIT"),
            "keywords_block": render_keywords_block(project["app"].get("keywords", [])),
            "classifiers_block": render_classifiers_block(min_required_python),
            "requires_python": f">={min_required_python}",
            "package_name": package_name,
            "autotest_start_class": f"{package_name}.{client_class_name}",
        },
    )


def render_authors_block(authors: Any) -> str:
    items: list[str] = []
    if isinstance(authors, list):
        for author in authors:
            if not isinstance(author, dict):
                continue
            fields = [f'name = {json.dumps(str(author.get("name", "")))}']
            email = str(author.get("email", "")).strip()
            if email:
                fields.append(f'email = {json.dumps(email)}')
            items.append("    { " + ", ".join(fields) + " }")
    if not items:
        return "authors = []"
    return "authors = [\n" + ",\n".join(items) + "\n]"


def render_keywords_block(keywords: Any) -> str:
    return render_toml_string_list("keywords", keywords)


@lru_cache(maxsize=1)
def latest_supported_python_minor() -> int:
    families = load_python_release_families()
    if len(families) < 2:
        raise RuntimeError(
            "Could not determine the penultimate Python 3 minor family from the python.org releases API."
        )
    return families[1][1]


def load_python_release_families() -> list[tuple[int, int]]:
    try:
        with urlopen(PYTHON_RELEASES_API_URL, timeout=PYTHON_RELEASES_API_TIMEOUT_SECONDS) as response:
            data = json.load(response)
    except OSError as exc:  # pragma: no cover - depends on network availability
        raise RuntimeError(
            "Failed to load python.org releases API."
        ) from exc
    if not isinstance(data, list):
        raise RuntimeError("Unexpected response format from python.org releases API.")

    families = {
        (version.major, version.minor)
        for version in extract_python_release_versions(data)
    }
    return sorted(families, reverse=True)


def extract_python_release_versions(data: Any) -> list[Version]:
    versions: list[Version] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name", ""))
        if not name.startswith("Python "):
            continue
        raw_version = name.removeprefix("Python ").strip()
        try:
            version = Version(raw_version)
        except Exception:
            continue
        if version.major != 3:
            continue
        if version.is_prerelease or version.is_devrelease:
            continue
        versions.append(version)
    return versions


def render_classifiers_block(min_required_python: str) -> str:
    match = re.fullmatch(r"(\d+)\.(\d+)", min_required_python.strip())
    if not match:
        version_labels = [f"Programming Language :: Python :: {min_required_python.strip()}"]
    else:
        major = int(match.group(1))
        start_minor = int(match.group(2))
        version_labels = [f"Programming Language :: Python :: {major}"]
        if major == 3:
            end_minor = max(start_minor, latest_supported_python_minor())
            version_labels.extend(
                f"Programming Language :: Python :: 3.{minor}"
                for minor in range(start_minor, end_minor + 1)
            )
        else:
            version_labels.append(f"Programming Language :: Python :: {major}.{start_minor}")
    version_labels.extend(
        [
            "Operating System :: Microsoft :: Windows",
            "Operating System :: POSIX :: Linux",
            "Intended Audience :: Developers",
            "Intended Audience :: Information Technology",
            "Topic :: Software Development :: Libraries :: Python Modules",
            "Topic :: Internet",
            "Topic :: Utilities",
        ]
    )
    return render_toml_string_list("classifiers", version_labels)


def render_toml_string_list(key: str, values: Any) -> str:
    items: list[str] = []
    if isinstance(values, list):
        for value in values:
            text = str(value).strip()
            if not text:
                continue
            items.append(json.dumps(text))
    if not items:
        return f"{key} = []"
    if len(items) == 1:
        return f"{key} = [{items[0]}]"
    return f"{key} = [\n    " + ",\n    ".join(items) + "\n]"


def write_root_license(output_dir: Path, project: dict[str, Any]) -> None:
    license_name = resolve_license_template_name(str(project["app"].get("license", "MIT") or "").strip() or "MIT")
    authors = project["app"].get("authors", [])
    license_text = render_license_text(license_name, authors)
    write_text(output_dir / "LICENSE", license_text)


def resolve_license_template_name(license_name: str) -> str:
    normalized = license_name.strip()
    if normalized in {"GPL-3.0", "GPL-3.0+"}:
        return "GPL-3.0-or-later"
    return normalized


def render_license_text(license_name: str, authors: Any) -> str:
    context = {}
    if license_name == "MIT":
        context = {
            "copyright_holders": format_copyright_holders(authors),
            "year": datetime.now().year,
        }
    template_name = f"licenses/{license_name}.txt.tpl"
    try:
        return render_template(template_name, context)
    except TemplateNotFound as exc:  # pragma: no cover - guardrail for unsupported licenses
        raise RuntimeError(
            f'Missing local license template "{template_name}". Add it under msra_codegen/templates/licenses/.'
        ) from exc


def format_copyright_holders(authors: Any) -> str:
    names: list[str] = []
    if isinstance(authors, list):
        for author in authors:
            if not isinstance(author, dict):
                continue
            name = str(author.get("name", "")).strip()
            if name:
                names.append(name)
    if not names:
        return "The authors"
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return " and ".join(names)
    return ", ".join(names[:-1]) + ", and " + names[-1]
