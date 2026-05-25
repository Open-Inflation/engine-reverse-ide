from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from .bridge import load_msra_document
from .msra_serializer import write_merged_msra_document
from .package_writer import generate_project
from .project_model import build_project


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="msra-codegen",
        description="Generate an async Python client and Sphinx docs from an MSRA document.",
    )
    parser.add_argument("msra_file", type=Path, help="Path to the source .msra file")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("generated"),
        help="Output directory for the generated project (default: ./generated)",
    )
    parser.add_argument(
        "--no-cleanup",
        action="store_true",
        help="Keep the existing output directory contents and preserve merged.msra after generation",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)

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
    return 0


def remove_output_tree(output_root: Path) -> None:
    if not output_root.exists():
        return
    if output_root.is_dir() and not output_root.is_symlink():
        shutil.rmtree(output_root)
        return
    output_root.unlink()


if __name__ == "__main__":
    raise SystemExit(main())
