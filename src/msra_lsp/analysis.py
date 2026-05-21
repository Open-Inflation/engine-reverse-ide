from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from .model import (
    AssignmentDef,
    Diagnostic,
    Expr,
    IdentExpr,
    InlineTableExpr,
    ParsedDocument,
    Position,
    Range,
    RefExpr,
    ReferenceOccurrence,
    SequenceExpr,
    TableDef,
)


KNOWN_DYNAMIC_ROOTS = {
    "UNSTANDART_HEADERS",
    "CAPTURED_URLS",
    "COOKIES",
    "LOCAL_STORAGE",
    "SESSION_STORAGE",
}

VIRTUAL_ROOTS = {
    "DOCUMENT",
    "VARIABLES",
    "INPUT",
}


@dataclass(slots=True)
class AnalysisResult:
    document: ParsedDocument
    diagnostics: list[Diagnostic] = field(default_factory=list)
    table_index: dict[tuple[str, ...], TableDef] = field(default_factory=dict)
    assignment_index: dict[tuple[str, ...], AssignmentDef] = field(default_factory=dict)
    root_table_index: dict[str, tuple[str, ...]] = field(default_factory=dict)


def analyze_document(document: ParsedDocument) -> AnalysisResult:
    diagnostics = list(document.diagnostics)
    table_index = dict(document.tables)
    assignment_index = dict(document.assignments)
    root_table_index = {
        ".".join(path): path
        for path in table_index
        if path
    }
    result = AnalysisResult(
        document=document,
        diagnostics=diagnostics,
        table_index=table_index,
        assignment_index=assignment_index,
        root_table_index=root_table_index,
    )

    for ref in document.references:
        resolved = resolve_reference(ref, result)
        ref.resolved_path = resolved[0] if resolved else None
        ref.resolved_kind = resolved[1] if resolved else None
        if resolved is None and ref.expr.parts:
            root = ref.expr.parts[0].value
            if root not in KNOWN_DYNAMIC_ROOTS and root not in VIRTUAL_ROOTS:
                diagnostics.append(
                    Diagnostic(
                        f"Unresolved reference <{render_ref(ref.expr)}>",
                        ref.range,
                        code="unresolved-reference",
                    )
                )
    return result


def render_ref(ref: RefExpr) -> str:
    rendered: list[str] = []
    for part in ref.parts:
        if part.kind == "name":
            if rendered:
                rendered.append(".")
            rendered.append(str(part.value))
        elif part.kind == "index":
            rendered.append("[...]")
        elif part.kind == "call":
            rendered.append("(...)")
    return "".join(rendered)


def resolve_reference(ref: ReferenceOccurrence, result: AnalysisResult) -> tuple[tuple[str, ...], str] | None:
    path = ref_path_segments(ref.expr)
    if not path:
        return None
    table_path = ref.table_path
    expanded = expand_virtual_path(path, table_path)
    if expanded is not None:
        resolved = resolve_static_path(expanded, result)
        if resolved is not None:
            return resolved
    resolved = resolve_static_path(tuple(path), result)
    if resolved is not None:
        return resolved
    # fallback for virtual roots that have no static target
    root = path[0]
    if root in KNOWN_DYNAMIC_ROOTS:
        return tuple(path), "dynamic-root"
    return None


def ref_path_segments(ref: RefExpr) -> list[str]:
    path: list[str] = []
    for part in ref.parts:
        if part.kind != "name":
            break
        path.append(str(part.value))
    return path


def expand_virtual_path(path: list[str], current_table: tuple[str, ...]) -> tuple[str, ...] | None:
    if not path:
        return None
    root = path[0]
    if root == "DOCUMENT":
        if len(path) >= 2 and path[1] == "PREFIXES":
            return ("app", "prefixes", *path[2:])
        if len(path) >= 2 and path[1] in {"REGEX", "REGEXES"}:
            return ("app", "regexes", *path[2:])
        if len(path) >= 2 and path[1] == "WARMUP":
            return ("app", "warmup", *path[2:])
    if root == "VARIABLES":
        return ("app", "variables", *path[1:])
    if root == "INPUT":
        function_id = current_function_id(current_table)
        if function_id:
            return ("app", "func", function_id, "input", *path[1:])
    return None


def current_function_id(table_path: tuple[str, ...]) -> str | None:
    segments = list(table_path)
    for index in range(len(segments) - 2):
        if segments[index] == "app" and segments[index + 1] == "func":
            return segments[index + 2]
    return None


def resolve_static_path(path: tuple[str, ...], result: AnalysisResult) -> tuple[tuple[str, ...], str] | None:
    if path in result.assignment_index:
        return path, "assignment"
    if path in result.table_index:
        return path, "table"
    if not path:
        return None
    # Allow direct table access to nested symbols by matching prefixes.
    if len(path) > 1:
        for index in range(len(path) - 1, 0, -1):
            prefix = path[:index]
            suffix = path[index:]
            if prefix in result.table_index and suffix and len(suffix) == 1:
                candidate = prefix + suffix
                if candidate in result.assignment_index:
                    return candidate, "assignment"
    return None


def collect_definition_locations(result: AnalysisResult) -> dict[tuple[str, ...], Range]:
    locations: dict[tuple[str, ...], Range] = {}
    for path, table in result.table_index.items():
        locations[path] = table.header_range
    for path, assignment in result.assignment_index.items():
        locations[path] = assignment.key_range
    return locations


def table_children(result: AnalysisResult, table_path: tuple[str, ...]) -> list[tuple[str, ...]]:
    children: list[tuple[str, ...]] = []
    for path in result.table_index:
        if len(path) == len(table_path) + 1 and path[: len(table_path)] == table_path:
            children.append(path)
    return sorted(children)


def iter_all_paths(result: AnalysisResult) -> Iterable[tuple[str, ...]]:
    yield from sorted(result.table_index)
    yield from sorted(result.assignment_index)

