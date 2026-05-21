from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True, slots=True)
class Position:
    line: int
    character: int


@dataclass(frozen=True, slots=True)
class Range:
    start: Position
    end: Position


@dataclass(slots=True)
class Diagnostic:
    message: str
    range: Range
    severity: str = "error"
    source: str = "msra"
    code: str | None = None


@dataclass(slots=True)
class Token:
    type: str
    value: str
    range: Range


@dataclass(slots=True)
class Expr:
    range: Range


@dataclass(slots=True)
class StringExpr(Expr):
    value: str
    raw: str


@dataclass(slots=True)
class NumberExpr(Expr):
    value: int | float
    raw: str


@dataclass(slots=True)
class BoolExpr(Expr):
    value: bool


@dataclass(slots=True)
class NullExpr(Expr):
    pass


@dataclass(slots=True)
class IdentExpr(Expr):
    name: str


@dataclass(slots=True)
class NamedArg:
    name: str
    name_range: Range
    value: Expr


@dataclass(slots=True)
class CallExpr(Expr):
    callee: Expr
    args: list[NamedArg] = field(default_factory=list)


@dataclass(slots=True)
class IndexExpr(Expr):
    value: Expr


@dataclass(slots=True)
class RefSegment:
    kind: str
    value: Any
    range: Range


@dataclass(slots=True)
class RefExpr(Expr):
    parts: list[RefSegment] = field(default_factory=list)


@dataclass(slots=True)
class SequenceExpr(Expr):
    items: list[Expr] = field(default_factory=list)


@dataclass(slots=True)
class MergeExpr(Expr):
    parts: list[Expr] = field(default_factory=list)


@dataclass(slots=True)
class ArrayExpr(Expr):
    items: list[Expr] = field(default_factory=list)


@dataclass(slots=True)
class InlineEntry:
    key: str
    key_range: Range
    value: Expr


@dataclass(slots=True)
class InlineTableExpr(Expr):
    items: list[InlineEntry] = field(default_factory=list)


@dataclass(slots=True)
class TableDef:
    path: tuple[str, ...]
    header_range: Range
    assignments: list["AssignmentDef"] = field(default_factory=list)


@dataclass(slots=True)
class AssignmentDef:
    table_path: tuple[str, ...]
    key: str
    key_range: Range
    value: Expr
    value_range: Range
    full_path: tuple[str, ...]


@dataclass(slots=True)
class ReferenceOccurrence:
    expr: RefExpr
    range: Range
    table_path: tuple[str, ...]
    resolved_path: tuple[str, ...] | None = None
    resolved_kind: str | None = None


@dataclass(slots=True)
class ParsedDocument:
    uri: str
    text: str
    line_starts: list[int]
    tokens: list[Token]
    diagnostics: list[Diagnostic]
    tables: dict[tuple[str, ...], TableDef]
    assignments: dict[tuple[str, ...], AssignmentDef]
    references: list[ReferenceOccurrence]
    errors: list[Diagnostic]

    def position_at(self, offset: int) -> Position:
        if offset <= 0:
            return Position(0, 0)
        if offset >= len(self.text):
            if not self.line_starts:
                return Position(0, offset)
            line = len(self.line_starts) - 1
            return Position(line, max(0, len(self.text) - self.line_starts[-1]))
        low = 0
        high = len(self.line_starts) - 1
        while low <= high:
            mid = (low + high) // 2
            start = self.line_starts[mid]
            next_start = self.line_starts[mid + 1] if mid + 1 < len(self.line_starts) else len(self.text) + 1
            if start <= offset < next_start:
                return Position(mid, offset - start)
            if offset < start:
                high = mid - 1
            else:
                low = mid + 1
        return Position(0, offset)

    def range_from_offsets(self, start: int, end: int) -> Range:
        return Range(self.position_at(start), self.position_at(end))

    def offset_at(self, position: Position) -> int:
        if position.line <= 0:
            return max(0, position.character)
        if position.line >= len(self.line_starts):
            return len(self.text)
        return min(len(self.text), self.line_starts[position.line] + max(0, position.character))

