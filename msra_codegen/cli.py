from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .bridge import load_msra_document
from .generator import build_project, generate_project
from .msra_serializer import write_merged_msra_document


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
    return parser


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)

    ast = load_msra_document(args.msra_file)
    output_root = args.output.resolve()
    merged_source_path = output_root / "merged.msra"
    write_merged_msra_document(ast, merged_source_path)
    project = build_project(ast, args.msra_file)
    generate_project(
        project,
        output_dir=args.output,
        source_root=args.msra_file.resolve().parent,
    )

    print(
        f"Generated {project['app'].get('package_name', '')} into {output_root} "
        f"(merged source in {merged_source_path}, docs in {output_root / 'docs'})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
