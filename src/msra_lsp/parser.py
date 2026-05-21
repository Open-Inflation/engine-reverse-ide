from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

from .model import (
    ArrayExpr,
    AssignmentDef,
    BoolExpr,
    CallExpr,
    Diagnostic,
    Expr,
    IdentExpr,
    InlineEntry,
    InlineTableExpr,
    MergeExpr,
    NamedArg,
    NullExpr,
    NumberExpr,
    ParsedDocument,
    Position,
    Range,
    RefExpr,
    RefSegment,
    ReferenceOccurrence,
    SequenceExpr,
    StringExpr,
    TableDef,
    Token,
)


ATOM_STARTS = {
    "STRING",
    "NUMBER",
    "IDENT",
    "LBRACE",
    "LBRACK",
    "LT",
    "LPAREN",
}


@dataclass(slots=True)
class ParseState:
    text: str
    uri: str
    line_starts: list[int]
    tokens: list[Token]
    diagnostics: list[Diagnostic]


class Tokenizer:
    def __init__(self, text: str):
        self.text = text
        self.length = len(text)
        self.offset = 0
        self.line = 0
        self.character = 0
        self.tokens: list[Token] = []
        self.diagnostics: list[Diagnostic] = []

    def _position(self) -> Position:
        return Position(self.line, self.character)

    def _emit(self, token_type: str, value: str, start: Position, end: Position) -> None:
        self.tokens.append(Token(token_type, value, Range(start, end)))

    def _advance_char(self) -> str:
        char = self.text[self.offset]
        self.offset += 1
        if char == "\r":
            if self.offset < self.length and self.text[self.offset] == "\n":
                self.offset += 1
                self.line += 1
                self.character = 0
                return "\n"
            self.line += 1
            self.character = 0
            return "\n"
        if char == "\n":
            self.line += 1
            self.character = 0
            return "\n"
        self.character += 1
        return char

    def _peek_char(self, offset: int = 0) -> str | None:
        index = self.offset + offset
        if index >= self.length:
            return None
        return self.text[index]

    def _take_while(self, predicate) -> str:
        start = self.offset
        while self.offset < self.length and predicate(self.text[self.offset]):
            self._advance_char()
        return self.text[start:self.offset]

    def tokenize(self) -> tuple[list[Token], list[Diagnostic], list[int]]:
        while self.offset < self.length:
            char = self._peek_char()
            if char is None:
                break
            if char in " \t":
                self._advance_char()
                continue
            if char in "\r\n":
                start = self._position()
                self._advance_char()
                end = self._position()
                self._emit("NEWLINE", "\n", start, end)
                continue
            if char == "#":
                while self._peek_char() not in (None, "\n", "\r"):
                    self._advance_char()
                continue
            if char == "[":
                start = self._position()
                self._advance_char()
                self._emit("LBRACK", "[", start, self._position())
                continue
            if char == "]":
                start = self._position()
                self._advance_char()
                self._emit("RBRACK", "]", start, self._position())
                continue
            if char == "{":
                start = self._position()
                self._advance_char()
                self._emit("LBRACE", "{", start, self._position())
                continue
            if char == "}":
                start = self._position()
                self._advance_char()
                self._emit("RBRACE", "}", start, self._position())
                continue
            if char == "(":
                start = self._position()
                self._advance_char()
                self._emit("LPAREN", "(", start, self._position())
                continue
            if char == ")":
                start = self._position()
                self._advance_char()
                self._emit("RPAREN", ")", start, self._position())
                continue
            if char == "<":
                start = self._position()
                self._advance_char()
                self._emit("LT", "<", start, self._position())
                continue
            if char == ">":
                start = self._position()
                self._advance_char()
                self._emit("GT", ">", start, self._position())
                continue
            if char == "=":
                start = self._position()
                self._advance_char()
                self._emit("EQ", "=", start, self._position())
                continue
            if char == ":":
                start = self._position()
                self._advance_char()
                self._emit("COLON", ":", start, self._position())
                continue
            if char == ",":
                start = self._position()
                self._advance_char()
                self._emit("COMMA", ",", start, self._position())
                continue
            if char == "+":
                start = self._position()
                self._advance_char()
                self._emit("PLUS", "+", start, self._position())
                continue
            if char == ".":
                start = self._position()
                self._advance_char()
                self._emit("DOT", ".", start, self._position())
                continue
            if char == '"':
                self._lex_string()
                continue
            if char.isdigit() or (char in "+-" and (self._peek_char(1) or "").isdigit()):
                self._lex_number()
                continue
            if self._is_identifier_start(char):
                self._lex_identifier()
                continue
            start = self._position()
            self._advance_char()
            self.diagnostics.append(
                Diagnostic(
                    f"Unexpected character {char!r}",
                    Range(start, self._position()),
                    code="unexpected-character",
                )
            )
        eof = self._position()
        self._emit("EOF", "", eof, eof)
        line_starts = [0]
        for index, char in enumerate(self.text):
            if char == "\n":
                line_starts.append(index + 1)
        return self.tokens, self.diagnostics, line_starts

    def _is_identifier_start(self, char: str) -> bool:
        return char.isalpha() or char == "_" or ord(char) > 127

    def _is_identifier_part(self, char: str) -> bool:
        return char.isalnum() or char in "_-" or ord(char) > 127

    def _lex_identifier(self) -> None:
        start = self._position()
        value = self._take_while(self._is_identifier_part)
        self._emit("IDENT", value, start, self._position())

    def _lex_number(self) -> None:
        start = self._position()
        text = self.text
        offset = self.offset
        if text[offset] in "+-":
            self._advance_char()
        saw_digit = False
        while self._peek_char() is not None and self._peek_char().isdigit():
            saw_digit = True
            self._advance_char()
        if self._peek_char() == "." and (self._peek_char(1) or "").isdigit():
            self._advance_char()
            while self._peek_char() is not None and self._peek_char().isdigit():
                saw_digit = True
                self._advance_char()
        if self._peek_char() in ("e", "E"):
            lookahead = self._peek_char(1)
            if lookahead is not None and (lookahead.isdigit() or lookahead in "+-"):
                self._advance_char()
                if self._peek_char() in "+-":
                    self._advance_char()
                while self._peek_char() is not None and self._peek_char().isdigit():
                    saw_digit = True
                    self._advance_char()
        raw = text[offset:self.offset]
        if not saw_digit:
            self.diagnostics.append(
                Diagnostic(
                    f"Invalid numeric literal {raw!r}",
                    Range(start, self._position()),
                    code="invalid-number",
                )
            )
        self._emit("NUMBER", raw, start, self._position())

    def _lex_string(self) -> None:
        start = self._position()
        self._advance_char()  # opening quote
        chars: list[str] = []
        raw_start = self.offset
        while True:
            char = self._peek_char()
            if char is None:
                self.diagnostics.append(
                    Diagnostic(
                        "Unterminated string literal",
                        Range(start, self._position()),
                        code="unterminated-string",
                    )
                )
                break
            if char == '"':
                break
            if char == "\\":
                self._advance_char()
                escaped = self._peek_char()
                if escaped is None:
                    break
                self._advance_char()
                chars.append(self._decode_escape(escaped))
                continue
            if char in "\r\n":
                self.diagnostics.append(
                    Diagnostic(
                        "Unterminated string literal",
                        Range(start, self._position()),
                        code="unterminated-string",
                    )
                )
                break
            chars.append(char)
            self._advance_char()
        raw = self.text[raw_start:self.offset]
        if self._peek_char() == '"':
            self._advance_char()
        self._emit("STRING", "".join(chars), start, self._position())

    def _decode_escape(self, char: str) -> str:
        mapping = {"n": "\n", "r": "\r", "t": "\t", '"': '"', "\\": "\\"}
        return mapping.get(char, char)


class Parser:
    def __init__(self, state: ParseState):
        self.state = state
        self.tokens = state.tokens
        self.index = 0
        self.text = state.text
        self.diagnostics = state.diagnostics
        self.tables: dict[tuple[str, ...], TableDef] = {}
        self.assignments: dict[tuple[str, ...], AssignmentDef] = {}
        self.references: list[ReferenceOccurrence] = []
        self.current_table: tuple[str, ...] = ()

    def parse(self) -> ParsedDocument:
        while not self._check("EOF"):
            self._skip_newlines()
            if self._check("EOF"):
                break
            if self._check("LBRACK"):
                self._parse_table_header()
                continue
            self._parse_assignment_or_recover()
        return ParsedDocument(
            uri=self.state.uri,
            text=self.text,
            line_starts=self.state.line_starts,
            tokens=self.tokens,
            diagnostics=self.diagnostics,
            tables=self.tables,
            assignments=self.assignments,
            references=self.references,
            errors=self.diagnostics,
        )

    def _current(self) -> Token:
        return self.tokens[self.index]

    def _previous(self) -> Token:
        return self.tokens[max(0, self.index - 1)]

    def _advance(self) -> Token:
        token = self.tokens[self.index]
        if not self._check("EOF"):
            self.index += 1
        return token

    def _check(self, token_type: str) -> bool:
        return self._current().type == token_type

    def _match(self, *types: str) -> bool:
        if self._current().type in types:
            self._advance()
            return True
        return False

    def _skip_newlines(self) -> None:
        while self._match("NEWLINE"):
            pass

    def _parse_table_header(self) -> None:
        start = self._advance()
        path = self._parse_path(until="RBRACK")
        end = self._expect("RBRACK", "Expected ']' to close table header")
        table_range = Range(start.range.start, end.range.end if end else self._previous().range.end)
        if not path:
            self._error("Empty table header", table_range, "empty-table-header")
            self._sync_to_next_statement()
            return
        table_path = tuple(path)
        if table_path in self.tables:
            previous = self.tables[table_path]
            self._error(
                f"Duplicate table declaration for {'.'.join(table_path)}",
                table_range,
                "duplicate-table",
            )
            # keep the first definition, but continue collecting assignments in the latest declaration
        else:
            self.tables[table_path] = TableDef(path=table_path, header_range=table_range)
        self.current_table = table_path
        if not self._match("NEWLINE", "EOF"):
            self._error("Expected end of line after table header", self._current().range, "trailing-table-header")
            self._sync_to_next_statement()

    def _parse_assignment_or_recover(self) -> None:
        start_index = self.index
        key_token = self._parse_key_token()
        if key_token is None:
            self._error("Expected key or table header", self._current().range, "expected-key")
            self._sync_to_next_statement()
            return
        if not self._match("EQ"):
            self._error("Expected '=' after key", self._current().range, "expected-equals")
            self._sync_to_next_statement()
            return
        value = self._parse_expr(stop_on_newline=True)
        assignment_range = Range(key_token.range.start, value.range.end if value else self._previous().range.end)
        key = key_token.value
        full_path = self.current_table + (key,)
        assignment = AssignmentDef(
            table_path=self.current_table,
            key=key,
            key_range=key_token.range,
            value=value,
            value_range=value.range,
            full_path=full_path,
        )
        if full_path in self.assignments:
            self._error(
                f"Duplicate assignment for {'.'.join(full_path)}",
                assignment_range,
                "duplicate-assignment",
            )
        else:
            self.assignments[full_path] = assignment
        if self.current_table not in self.tables:
            # A naked assignment before a table header is legal enough for linting purposes.
            self.tables[self.current_table] = TableDef(path=self.current_table, header_range=key_token.range)
        self.tables[self.current_table].assignments.append(assignment)
        if self._check("NEWLINE"):
            self._advance()
        elif not self._check("EOF"):
            self._error("Expected end of line after assignment", self._current().range, "trailing-assignment")
            self._sync_to_next_statement()

    def _parse_key_token(self) -> Token | None:
        if self._check("IDENT") or self._check("STRING"):
            return self._advance()
        return None

    def _parse_path(self, until: str) -> list[str]:
        path: list[str] = []
        if self._check(until) or self._check("EOF"):
            return path
        segment = self._parse_path_segment()
        if segment is None:
            return path
        path.append(segment)
        while self._match("DOT"):
            segment = self._parse_path_segment()
            if segment is None:
                self._error("Expected path segment after '.'", self._current().range, "expected-path-segment")
                break
            path.append(segment)
        return path

    def _parse_path_segment(self) -> str | None:
        if self._check("IDENT") or self._check("STRING"):
            return self._advance().value
        return None

    def _parse_expr(self, stop_on_newline: bool) -> Expr:
        parts = [self._parse_concat(stop_on_newline)]
        while self._match("PLUS"):
            parts.append(self._parse_concat(stop_on_newline))
        if len(parts) == 1:
            return parts[0]
        start = parts[0].range.start
        end = parts[-1].range.end
        return MergeExpr(range=Range(start, end), parts=parts)

    def _parse_concat(self, stop_on_newline: bool) -> Expr:
        items: list[Expr] = []
        first = self._parse_atom(stop_on_newline)
        if first is None:
            empty_range = self._current().range
            self._error("Expected value", empty_range, "expected-value")
            return NullExpr(range=empty_range)
        items.append(first)
        while True:
            if self._at_value_terminator(stop_on_newline):
                break
            if self._current().type in {"COMMA", "RBRACE", "RBRACK", "RPAREN", "EOF"}:
                break
            if self._current().type == "NEWLINE" and stop_on_newline:
                break
            if self._current().type not in ATOM_STARTS and self._current().type != "IDENT":
                break
            nxt = self._parse_atom(stop_on_newline)
            if nxt is None:
                break
            items.append(nxt)
        if len(items) == 1:
            return items[0]
        return SequenceExpr(range=Range(items[0].range.start, items[-1].range.end), items=items)

    def _at_value_terminator(self, stop_on_newline: bool) -> bool:
        if self._check("EOF"):
            return True
        if stop_on_newline and self._check("NEWLINE"):
            return True
        return False

    def _parse_atom(self, stop_on_newline: bool) -> Expr | None:
        token = self._current()
        if token.type == "STRING":
            self._advance()
            return StringExpr(range=token.range, value=token.value, raw=token.value)
        if token.type == "NUMBER":
            self._advance()
            raw = token.value
            value: int | float
            if any(ch in raw for ch in ".eE"):
                try:
                    value = float(raw)
                except ValueError:
                    value = 0.0
            else:
                try:
                    value = int(raw)
                except ValueError:
                    value = 0
            return NumberExpr(range=token.range, value=value, raw=raw)
        if token.type == "IDENT":
            self._advance()
            if token.value == "true":
                return BoolExpr(range=token.range, value=True)
            if token.value == "false":
                return BoolExpr(range=token.range, value=False)
            if token.value == "null":
                return NullExpr(range=token.range)
            expr: Expr = IdentExpr(range=token.range, name=token.value)
            if self._check("LPAREN"):
                expr = self._parse_call(expr)
            return expr
        if token.type == "LT":
            return self._parse_reference()
        if token.type == "LBRACK":
            return self._parse_array()
        if token.type == "LBRACE":
            return self._parse_inline_table()
        if token.type == "LPAREN":
            self._advance()
            inner = self._parse_expr(stop_on_newline=False)
            end = self._expect("RPAREN", "Expected ')' to close group")
            if end is None:
                return inner
            return inner
        if token.type == "NEWLINE" and stop_on_newline:
            return None
        return None

    def _parse_call(self, callee: Expr) -> CallExpr:
        start = callee.range.start
        self._expect("LPAREN", "Expected '(' after callable")
        args: list[NamedArg] = []
        while not self._check("RPAREN") and not self._check("EOF"):
            if self._check("NEWLINE"):
                self._advance()
                continue
            name_token = self._parse_key_token()
            if name_token is None:
                self._error("Expected named argument", self._current().range, "expected-named-argument")
                self._sync_until({"COMMA", "RPAREN"})
                if self._match("COMMA"):
                    continue
                break
            if not self._match("EQ"):
                self._error("Expected '=' after argument name", self._current().range, "expected-argument-equals")
                self._sync_until({"COMMA", "RPAREN"})
                if self._match("COMMA"):
                    continue
                break
            value = self._parse_expr(stop_on_newline=False)
            args.append(NamedArg(name=name_token.value, name_range=name_token.range, value=value))
            if self._match("COMMA"):
                continue
            if self._check("RPAREN"):
                break
        end = self._expect("RPAREN", "Expected ')' to close call") or self._previous()
        return CallExpr(range=Range(start, end.range.end), callee=callee, args=args)

    def _parse_reference(self) -> RefExpr:
        start = self._advance()
        parts: list[RefSegment] = []
        if not self._check("IDENT"):
            self._error("Expected reference root name after '<'", self._current().range, "expected-reference-root")
            self._sync_until({"GT", "NEWLINE", "EOF"})
            end = self._expect("GT", "Expected '>' to close reference") or self._previous()
            return RefExpr(range=Range(start.range.start, end.range.end), parts=parts)
        root = self._advance()
        parts.append(RefSegment(kind="name", value=root.value, range=root.range))
        while not self._check("GT") and not self._check("EOF"):
            if self._match("DOT"):
                segment = self._parse_ref_name_segment()
                if segment is None:
                    self._error("Expected path segment in reference", self._current().range, "expected-ref-segment")
                    break
                parts.append(RefSegment(kind="name", value=segment.value, range=segment.range))
                continue
            if self._check("LBRACK"):
                parts.append(self._parse_ref_index())
                continue
            if self._check("LPAREN"):
                parts.append(self._parse_ref_call())
                continue
            break
        end = self._expect("GT", "Expected '>' to close reference")
        if end is None:
            end = self._previous()
        expr = RefExpr(range=Range(start.range.start, end.range.end), parts=parts)
        self.references.append(
            ReferenceOccurrence(
                expr=expr,
                range=expr.range,
                table_path=self.current_table,
            )
        )
        return expr

    def _parse_ref_name_segment(self) -> Token | None:
        if self._check("IDENT") or self._check("STRING"):
            return self._advance()
        return None

    def _parse_ref_index(self) -> RefSegment:
        start = self._advance()
        value = self._parse_expr(stop_on_newline=False)
        end = self._expect("RBRACK", "Expected ']' to close index") or self._previous()
        return RefSegment(kind="index", value=value, range=Range(start.range.start, end.range.end))

    def _parse_ref_call(self) -> RefSegment:
        start = self._advance()
        args: list[NamedArg] = []
        while not self._check("RPAREN") and not self._check("EOF"):
            if self._check("NEWLINE"):
                self._advance()
                continue
            name_token = self._parse_key_token()
            if name_token is None:
                self._error("Expected named filter argument", self._current().range, "expected-filter-argument")
                self._sync_until({"COMMA", "RPAREN"})
                if self._match("COMMA"):
                    continue
                break
            if not self._match("EQ"):
                self._error("Expected '=' after filter argument name", self._current().range, "expected-filter-equals")
                self._sync_until({"COMMA", "RPAREN"})
                if self._match("COMMA"):
                    continue
                break
            value = self._parse_expr(stop_on_newline=False)
            args.append(NamedArg(name=name_token.value, name_range=name_token.range, value=value))
            if self._match("COMMA"):
                continue
            if self._check("RPAREN"):
                break
        end = self._expect("RPAREN", "Expected ')' to close reference filter") or self._previous()
        return RefSegment(kind="call", value=args, range=Range(start.range.start, end.range.end))

    def _parse_array(self) -> ArrayExpr:
        start = self._advance()
        items: list[Expr] = []
        while not self._check("RBRACK") and not self._check("EOF"):
            if self._check("NEWLINE"):
                self._advance()
                continue
            item = self._parse_expr(stop_on_newline=False)
            items.append(item)
            if self._match("COMMA"):
                while self._check("NEWLINE"):
                    self._advance()
                continue
            if self._check("NEWLINE"):
                while self._check("NEWLINE"):
                    self._advance()
                continue
            if self._check("RBRACK"):
                break
            self._error("Expected ',' or ']' in array", self._current().range, "expected-array-separator")
            self._sync_until({"COMMA", "RBRACK"})
            self._match("COMMA")
        end = self._expect("RBRACK", "Expected ']' to close array") or self._previous()
        return ArrayExpr(range=Range(start.range.start, end.range.end), items=items)

    def _parse_inline_table(self) -> InlineTableExpr:
        start = self._advance()
        items: list[InlineEntry] = []
        while not self._check("RBRACE") and not self._check("EOF"):
            if self._check("NEWLINE"):
                self._advance()
                continue
            key_token = self._parse_key_token()
            if key_token is None:
                self._error("Expected inline table key", self._current().range, "expected-inline-key")
                self._sync_until({"COMMA", "RBRACE"})
                if self._match("COMMA"):
                    continue
                break
            if not (self._match("EQ") or self._match("COLON")):
                self._error("Expected '=' or ':' after inline table key", self._current().range, "expected-inline-equals")
                self._sync_until({"COMMA", "RBRACE"})
                if self._match("COMMA"):
                    continue
                break
            value = self._parse_expr(stop_on_newline=False)
            items.append(InlineEntry(key=key_token.value, key_range=key_token.range, value=value))
            if self._match("COMMA"):
                while self._check("NEWLINE"):
                    self._advance()
                continue
            if self._check("NEWLINE"):
                while self._check("NEWLINE"):
                    self._advance()
                continue
            if self._check("RBRACE"):
                break
            self._error("Expected ',' or '}' in inline table", self._current().range, "expected-inline-separator")
            self._sync_until({"COMMA", "RBRACE"})
            self._match("COMMA")
        end = self._expect("RBRACE", "Expected '}' to close inline table") or self._previous()
        return InlineTableExpr(range=Range(start.range.start, end.range.end), items=items)

    def _expect(self, token_type: str, message: str) -> Token | None:
        if self._check(token_type):
            return self._advance()
        self._error(message, self._current().range, f"expected-{token_type.lower()}")
        return None

    def _error(self, message: str, range_: Range, code: str | None = None) -> None:
        self.diagnostics.append(Diagnostic(message, range_, code=code))

    def _sync_to_next_statement(self) -> None:
        while not self._check("EOF") and not self._check("NEWLINE"):
            self._advance()
        self._match("NEWLINE")

    def _sync_until(self, token_types: set[str]) -> None:
        while not self._check("EOF") and self._current().type not in token_types:
            self._advance()


def parse_document(text: str, uri: str = "") -> ParsedDocument:
    tokenizer = Tokenizer(text)
    tokens, diagnostics, line_starts = tokenizer.tokenize()
    state = ParseState(text=text, uri=uri, line_starts=line_starts, tokens=tokens, diagnostics=list(diagnostics))
    parser = Parser(state)
    return parser.parse()
