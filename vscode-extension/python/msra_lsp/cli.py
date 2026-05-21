from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .analysis import analyze_document
from .model import Diagnostic, ParsedDocument, Position, Range
from .parser import parse_document
from .server import run_server


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="msra-lsp", description="MSRA language server and validator")
    parser.add_argument("--version", action="version", version="0.1.0")
    subparsers = parser.add_subparsers(dest="command")

    server_parser = subparsers.add_parser("server", help="Run the language server over stdio")

    check_parser = subparsers.add_parser("check", help="Validate one or more .msra files")
    check_parser.add_argument("files", nargs="+", help="Files to validate")
    check_parser.add_argument("--json", action="store_true", help="Emit diagnostics as JSON")

    dump_parser = subparsers.add_parser("dump", help="Parse a file and print a compact summary")
    dump_parser.add_argument("file", help="File to parse")

    return parser


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    prog = Path(sys.argv[0]).stem.lower()
    default_command = "check" if "check" in prog else "server"
    if argv and argv[0] in {"server", "check", "dump"}:
        command = argv[0]
    elif argv and argv[0] in {"-h", "--help", "--version"}:
        command = None
    elif argv:
        command = default_command
        argv = [command, *argv]
    else:
        command = default_command
        argv = [command]
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "server":
        run_server()
        return 0
    if args.command == "check":
        return run_check(args.files, json_output=args.json)
    if args.command == "dump":
        return run_dump(args.file)
    parser.print_help()
    return 0


def run_check(files: list[str], json_output: bool = False) -> int:
    payload = []
    exit_code = 0
    for file_name in files:
        path = Path(file_name)
        text = path.read_text(encoding="utf-8")
        parsed = parse_document(text, uri=path.resolve().as_uri())
        analyzed = analyze_document(parsed)
        diagnostics = [diagnostic_to_dict(d, parsed) for d in analyzed.diagnostics]
        payload.append({"file": str(path), "diagnostics": diagnostics})
        if any(d["severity"] == "error" for d in diagnostics):
            exit_code = 1
        if not json_output:
            print_file_diagnostics(path, diagnostics)
    if json_output:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return exit_code


def run_dump(file_name: str) -> int:
    path = Path(file_name)
    text = path.read_text(encoding="utf-8")
    parsed = parse_document(text, uri=path.resolve().as_uri())
    analyzed = analyze_document(parsed)
    print(f"uri: {parsed.uri}")
    print(f"tables: {len(analyzed.table_index)}")
    print(f"assignments: {len(analyzed.assignment_index)}")
    print(f"references: {len(parsed.references)}")
    print(f"diagnostics: {len(analyzed.diagnostics)}")
    return 0


def print_file_diagnostics(path: Path, diagnostics: list[dict[str, object]]) -> None:
    for item in diagnostics:
        severity = str(item["severity"]).upper()
        line = int(item["range"]["start"]["line"]) + 1
        character = int(item["range"]["start"]["character"]) + 1
        message = str(item["message"])
        print(f"{path}:{line}:{character}: {severity}: {message}", file=sys.stderr)


def diagnostic_to_dict(diagnostic: Diagnostic, parsed: ParsedDocument) -> dict[str, object]:
    return {
        "message": diagnostic.message,
        "severity": diagnostic.severity,
        "code": diagnostic.code,
        "source": diagnostic.source,
        "range": range_to_dict(diagnostic.range),
    }


def range_to_dict(range_: Range) -> dict[str, object]:
    return {
        "start": position_to_dict(range_.start),
        "end": position_to_dict(range_.end),
    }


def position_to_dict(position: Position) -> dict[str, int]:
    return {"line": position.line, "character": position.character}
