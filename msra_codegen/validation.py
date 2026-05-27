from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

import tomllib

from .generator_config import config_section


def validate_generated_project(output_root: Path) -> None:
    output_root = output_root.resolve()
    package_name = read_generated_package_name(output_root)
    validation_config = config_section("validation")
    checks = validation_config.get("checks", [])
    if not isinstance(checks, list) or not checks:
        raise RuntimeError("msra_codegen/config.toml must define validation.checks.")

    context = {
        "output_root": str(output_root),
        "package_name": package_name,
        "python_executable": sys.executable,
    }
    for raw_check in checks:
        check = normalize_check(raw_check)
        run_validation_check(output_root, check, context)


def read_generated_package_name(output_root: Path) -> str:
    pyproject_path = output_root / "pyproject.toml"
    if not pyproject_path.exists():
        raise FileNotFoundError(pyproject_path)

    with pyproject_path.open("rb") as handle:
        pyproject = tomllib.load(handle)
    if not isinstance(pyproject, dict):
        raise RuntimeError(f"Unexpected TOML structure in {pyproject_path}.")

    project = pyproject.get("project")
    if not isinstance(project, dict):
        raise RuntimeError(f"Missing [project] table in {pyproject_path}.")

    package_name = str(project.get("name", "")).strip()
    if not package_name:
        raise RuntimeError(f"Missing project.name in {pyproject_path}.")
    return package_name


def normalize_check(raw_check: Any) -> dict[str, list[str] | str]:
    if not isinstance(raw_check, dict):
        raise RuntimeError("validation.checks entries must be tables.")

    name = str(raw_check.get("name", "")).strip()
    if not name:
        raise RuntimeError("validation.checks entries must define a non-empty name.")

    argv = raw_check.get("argv", [])
    if not isinstance(argv, list) or not argv:
        raise RuntimeError(f"validation.checks.{name}.argv must be a non-empty list.")

    targets = raw_check.get("targets", [])
    if not isinstance(targets, list):
        raise RuntimeError(f"validation.checks.{name}.targets must be a list.")

    return {
        "name": name,
        "argv": [str(part) for part in argv],
        "targets": [str(target) for target in targets],
    }


def run_validation_check(
    output_root: Path,
    check: dict[str, list[str] | str],
    context: dict[str, str],
) -> None:
    name = str(check["name"])
    argv = [expand_placeholder(part, context) for part in check["argv"]]
    targets = [resolve_validation_target(target, output_root, context) for target in check["targets"]]
    command = [*argv, *targets]
    process = subprocess.run(
        command,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    if process.returncode == 0:
        return

    stderr = process.stderr.strip()
    stdout = process.stdout.strip()
    details = stderr or stdout or "validation command failed without output"
    raise RuntimeError(
        f"Validation check {name!r} failed with exit code {process.returncode}.\n"
        f"Command: {' '.join(command)}\n"
        f"{details}"
    )


def resolve_validation_target(target: str, output_root: Path, context: dict[str, str]) -> str:
    rendered = expand_placeholder(target, context)
    rendered_path = Path(rendered)
    if rendered_path.is_absolute():
        return str(rendered_path)
    current_root = Path.cwd().resolve()
    try:
        relative_output_root = output_root.relative_to(current_root)
    except ValueError:
        return str(output_root / rendered_path)
    relative_target = relative_output_root / rendered_path
    return f".\\{relative_target}".replace("/", "\\")


def expand_placeholder(value: str, context: dict[str, str]) -> str:
    try:
        return value.format(**context)
    except KeyError as exc:
        missing_key = exc.args[0]
        raise RuntimeError(f"Unknown validation placeholder {{{missing_key}}} in {value!r}.") from exc
