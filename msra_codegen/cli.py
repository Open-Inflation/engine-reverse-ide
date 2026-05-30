from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from .bridge import load_msra_document
from .msra_serializer import write_merged_msra_document
from .package_writer import generate_project
from .project_model import build_project
from .validation import validate_generated_project


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="msra-codegen",
        description="Generate or validate an async Python client and Sphinx docs from an MSRA document.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    generate_parser = subparsers.add_parser(
        "generate",
        help="Generate an async Python client and Sphinx docs from an MSRA document.",
    )
    generate_parser.add_argument("msra_file", type=Path, help="Path to the source .msra file")
    generate_parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("generated"),
        help="Output directory for the generated project (default: ./generated)",
    )
    generate_parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Keep the existing output directory contents and preserve merged.msra after generation",
    )
    generate_parser.set_defaults(handler=handle_generate)

    validate_parser = subparsers.add_parser(
        "validate",
        help="Validate a generated project with python syntax, ruff, and mypy.",
    )
    validate_parser.add_argument(
        "output_dir",
        type=Path,
        help="Path to a generated project directory",
    )
    validate_parser.set_defaults(handler=handle_validate)
    return parser


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)
    args.handler(args)
    return 0


def handle_generate(args: argparse.Namespace) -> None:
    ast = load_msra_document(args.msra_file)
    output_root = args.output.resolve()
    if not args.no_cleanup:
        remove_output_tree(output_root)
    merged_source_path = output_root / "merged.msra"
    write_merged_msra_document(ast, merged_source_path)
    project = build_project(ast, args.msra_file)
    try:
        generate_project(
            project,
            output_dir=args.output,
            source_root=args.msra_file.resolve().parent,
        )
    finally:
        if not args.no_cleanup and merged_source_path.exists():
            merged_source_path.unlink()

    message = f"Generated {project['app'].get('package_name', '')} into {output_root}"
    if args.no_cleanup:
        message += f" (merged source in {merged_source_path}, docs in {output_root / 'docs'})"
    else:
        message += f" (docs in {output_root / 'docs'}, merged source cleaned)"
    print(message)


def handle_validate(args: argparse.Namespace) -> None:
    output_root = args.output_dir.resolve()
    validate_generated_project(output_root)
    print(f"Validated generated project in {output_root}")


def remove_output_tree(output_root: Path) -> None:
    if not output_root.exists():
        return
    if output_root.is_dir() and not output_root.is_symlink():
        shutil.rmtree(output_root)
        return
    output_root.unlink()


if __name__ == "__main__":
    raise SystemExit(main())
