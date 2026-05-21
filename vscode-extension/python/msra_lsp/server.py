from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse
from urllib.request import url2pathname

from .analysis import (
    AnalysisResult,
    analyze_document,
    collect_definition_locations,
    current_function_id,
    expand_virtual_path,
    ref_path_segments,
    render_ref,
    resolve_reference,
)
from .model import Diagnostic, ParsedDocument, Position, Range
from .parser import parse_document


LSP_SEVERITY = {
    "error": 1,
    "warning": 2,
    "information": 3,
    "hint": 4,
}


@dataclass(slots=True)
class OpenDocument:
    uri: str
    text: str
    parsed: ParsedDocument
    analyzed: AnalysisResult


class MsraLanguageServer:
    def __init__(self) -> None:
        self._in = sys.stdin.buffer
        self._out = sys.stdout.buffer
        self._initialized = False
        self._shutdown = False
        self._documents: dict[str, OpenDocument] = {}
        self._root_uri: str | None = None
        self._server_name = "msra-lsp"
        self._server_version = "0.1.0"

    def run(self) -> None:
        while True:
            message = self._read_message()
            if message is None:
                break
            if "method" in message:
                if "id" in message:
                    result = self._handle_request(message["method"], message.get("params"), message["id"])
                    if result is not _NoResponse:
                        self._send_response(message["id"], result=result)
                else:
                    self._handle_notification(message["method"], message.get("params"))
            if self._shutdown and message.get("method") == "exit":
                break

    def _read_message(self) -> dict[str, Any] | None:
        headers: dict[str, str] = {}
        while True:
            line = self._in.readline()
            if not line:
                return None
            line = line.decode("ascii", errors="ignore").strip()
            if not line:
                break
            if ":" in line:
                key, value = line.split(":", 1)
                headers[key.strip().lower()] = value.strip()
        content_length = int(headers.get("content-length", "0"))
        if content_length <= 0:
            return None
        body = self._in.read(content_length)
        if not body:
            return None
        return json.loads(body.decode("utf-8"))

    def _send(self, payload: dict[str, Any]) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        header = f"Content-Length: {len(data)}\r\n\r\n".encode("ascii")
        self._out.write(header)
        self._out.write(data)
        self._out.flush()

    def _send_response(self, request_id: Any, *, result: Any = None, error: dict[str, Any] | None = None) -> None:
        payload = {"jsonrpc": "2.0", "id": request_id}
        if error is not None:
            payload["error"] = error
        else:
            payload["result"] = result
        self._send(payload)

    def _send_notification(self, method: str, params: Any | None = None) -> None:
        payload = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        self._send(payload)

    def _handle_request(self, method: str, params: Any, request_id: Any) -> Any:
        try:
            if method == "initialize":
                return self._initialize(params or {})
            if method == "shutdown":
                self._shutdown = True
                return None
            if method == "textDocument/completion":
                return self._completion(params or {})
            if method == "textDocument/hover":
                return self._hover(params or {})
            if method == "textDocument/definition":
                return self._definition(params or {})
            if method == "textDocument/documentSymbol":
                return self._document_symbol(params or {})
            if method == "workspace/symbol":
                return self._workspace_symbol(params or {})
            return None
        except Exception as exc:  # pragma: no cover - defensive
            return {
                "code": -32603,
                "message": f"{type(exc).__name__}: {exc}",
            }

    def _handle_notification(self, method: str, params: Any) -> None:
        if method == "initialized":
            self._initialized = True
            return
        if method == "exit":
            self._shutdown = True
            return
        if method == "textDocument/didOpen":
            self._update_document(params, publish=True)
            return
        if method == "textDocument/didChange":
            self._update_document(params, publish=True)
            return
        if method == "textDocument/didSave":
            self._update_document(params, publish=True)
            return
        if method == "textDocument/didClose":
            text_document = params.get("textDocument", {})
            uri = text_document.get("uri")
            if uri:
                self._documents.pop(uri, None)
                self._send_notification("textDocument/publishDiagnostics", {"uri": uri, "diagnostics": []})
            return

    def _initialize(self, params: dict[str, Any]) -> dict[str, Any]:
        self._root_uri = params.get("rootUri")
        capabilities = {
            "textDocumentSync": 1,
            "completionProvider": {
                "resolveProvider": False,
                "triggerCharacters": ["<", ".", "[", "\"", "="],
            },
            "hoverProvider": True,
            "definitionProvider": True,
            "documentSymbolProvider": True,
            "workspaceSymbolProvider": True,
        }
        return {
            "capabilities": capabilities,
            "serverInfo": {"name": self._server_name, "version": self._server_version},
        }

    def _update_document(self, params: dict[str, Any], publish: bool = False) -> None:
        text_document = params.get("textDocument", {})
        uri = text_document.get("uri")
        if not uri:
            return
        text = self._extract_text(uri, params)
        parsed = parse_document(text, uri=uri)
        analyzed = analyze_document(parsed)
        self._documents[uri] = OpenDocument(uri=uri, text=text, parsed=parsed, analyzed=analyzed)
        if publish:
            self._publish_diagnostics(uri, analyzed.diagnostics, parsed)

    def _extract_text(self, uri: str, params: dict[str, Any]) -> str:
        text_document = params.get("textDocument") or {}
        if isinstance(text_document, dict):
            text = text_document.get("text")
            if isinstance(text, str):
                return text
        changes = params.get("contentChanges") or []
        if changes:
            latest = changes[-1]
            if "text" in latest:
                return latest["text"]
        path = self._uri_to_path(uri)
        if path and path.exists():
            return path.read_text(encoding="utf-8")
        return ""

    def _publish_diagnostics(self, uri: str, diagnostics: list[Diagnostic], document: ParsedDocument) -> None:
        payload = {
            "uri": uri,
            "diagnostics": [self._diagnostic_to_lsp(diagnostic, document) for diagnostic in diagnostics],
        }
        self._send_notification("textDocument/publishDiagnostics", payload)

    def _diagnostic_to_lsp(self, diagnostic: Diagnostic, document: ParsedDocument) -> dict[str, Any]:
        return {
            "range": self._range_to_lsp(diagnostic.range),
            "severity": LSP_SEVERITY.get(diagnostic.severity, 1),
            "source": diagnostic.source,
            "code": diagnostic.code,
            "message": diagnostic.message,
        }

    def _completion(self, params: dict[str, Any]) -> dict[str, Any]:
        text_document = params.get("textDocument", {})
        uri = text_document.get("uri")
        document = self._documents.get(uri)
        if document is None:
            return {"isIncomplete": False, "items": []}
        position = self._position_from_lsp(params.get("position", {}))
        prefix, context = self._completion_context(document.parsed, position)
        items = self._completion_items(document.analyzed, prefix, context)
        return {"isIncomplete": False, "items": items}

    def _completion_context(self, document: ParsedDocument, position: Position) -> tuple[str, str]:
        offset = document.offset_at(position)
        text = document.text
        start = offset
        while start > 0 and text[start - 1] not in " \t\r\n=,+{}[]<>":
            start -= 1
        prefix = text[start:offset]
        line_start = document.line_starts[position.line] if position.line < len(document.line_starts) else 0
        line_prefix = text[line_start:offset]
        if "<" in line_prefix and line_prefix.rfind("<") > line_prefix.rfind(">"):
            return prefix, "reference"
        if "[" in line_prefix and line_prefix.rfind("[") > line_prefix.rfind("]"):
            return prefix, "table"
        return prefix, "value"

    def _completion_items(self, analyzed: AnalysisResult, prefix: str, context: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        if context == "reference":
            for label, detail in self._reference_completions(analyzed):
                if prefix and not label.startswith(prefix):
                    continue
                items.append(self._completion_item(label, detail, kind=21))
            return items
        if context == "table":
            for label, detail in self._table_completions(analyzed):
                if prefix and not label.startswith(prefix):
                    continue
                items.append(self._completion_item(label, detail, kind=21))
            return items
        for label, detail in self._value_completions():
            if prefix and not label.startswith(prefix):
                continue
            items.append(self._completion_item(label, detail, kind=12))
        return items

    def _reference_completions(self, analyzed: AnalysisResult) -> list[tuple[str, str]]:
        suggestions = [
            ("DOCUMENT", "Virtual namespace for document-level prefixes and regexes"),
            ("DOCUMENT.PREFIXES", "Resolves to [app.prefixes]"),
            ("DOCUMENT.PREFIXES.ORIGIN", "Current document origin prefix"),
            ("DOCUMENT.PREFIXES.BASE_API", "Base API prefix"),
            ("DOCUMENT.REGEX", "Alias for [app.regexes]"),
            ("DOCUMENT.REGEXES", "Resolves to [app.regexes]"),
            ("DOCUMENT.REGEX.TEXT_REQUEST", "Text filter regex"),
            ("DOCUMENT.REGEXES.TEXT_REQUEST", "Text filter regex"),
            ("VARIABLES", "Resolves to [app.variables]"),
            ("INPUT", "Resolves to the current function input namespace"),
            ("UNSTANDART_HEADERS", "Runtime request/response headers"),
            ("CAPTURED_URLS", "Runtime captured URL list"),
            ("COOKIES", "Runtime cookie store"),
            ("LOCAL_STORAGE", "Runtime local storage"),
            ("SESSION_STORAGE", "Runtime session storage"),
        ]
        # Add concrete document paths.
        for path in sorted(analyzed.table_index):
            suggestions.append((".".join(path), "Defined table"))
        for path in sorted(analyzed.assignment_index):
            suggestions.append((".".join(path), "Defined value"))
        return suggestions

    def _table_completions(self, analyzed: AnalysisResult) -> list[tuple[str, str]]:
        suggestions = [
            ("app", "Top-level application namespace"),
            ("misklerreverseapi", "Document root table"),
            ("warmup", "Warmup settings"),
            ("variables", "Variable definitions"),
            ("prefixes", "Reusable prefixes"),
            ("regexes", "Reusable regex definitions"),
            ("groups", "Function groups"),
            ("func", "Function definitions"),
            ("input", "Function input namespace"),
            ("body", "Function body definitions"),
            ("headers", "Function headers block"),
            ("url", "Function URL block"),
            ("examples", "Function examples"),
            ("from_global", "Shared input binding"),
        ]
        for path in sorted(analyzed.table_index):
            suggestions.append((".".join(path), "Existing table"))
        return suggestions

    def _value_completions(self) -> list[tuple[str, str]]:
        return [
            ("true", "Boolean true"),
            ("false", "Boolean false"),
            ("null", "Null value"),
            ("<DOCUMENT.PREFIXES.ORIGIN>", "Origin prefix reference"),
            ("<DOCUMENT.PREFIXES.BASE_API>", "Base API prefix reference"),
            ("<DOCUMENT.REGEXES.TEXT_REQUEST>", "Text request regex reference"),
            ("<VARIABLES.city_id>", "Variable reference"),
            ("<INPUT.query>", "Current input reference"),
        ]

    def _completion_item(self, label: str, detail: str, kind: int) -> dict[str, Any]:
        return {"label": label, "kind": kind, "detail": detail, "insertText": label}

    def _hover(self, params: dict[str, Any]) -> dict[str, Any] | None:
        text_document = params.get("textDocument", {})
        uri = text_document.get("uri")
        document = self._documents.get(uri)
        if document is None:
            return None
        position = self._position_from_lsp(params.get("position", {}))
        info = self._hover_at(document, position)
        if info is None:
            return None
        return {"contents": {"kind": "markdown", "value": info}}

    def _hover_at(self, document: OpenDocument, position: Position) -> str | None:
        for ref in document.parsed.references:
            if self._contains(ref.range, position):
                rendered = render_ref(ref.expr)
                if ref.resolved_path:
                    return f"**Reference** `{rendered}`\n\nResolves to `{'.'.join(ref.resolved_path)}` as {ref.resolved_kind}."
                return f"**Reference** `{rendered}`"
        for path, assignment in document.parsed.assignments.items():
            if self._contains(assignment.key_range, position):
                return f"**Assignment** `{'.'.join(path)}`"
        return None

    def _definition(self, params: dict[str, Any]) -> list[dict[str, Any]] | None:
        text_document = params.get("textDocument", {})
        uri = text_document.get("uri")
        document = self._documents.get(uri)
        if document is None:
            return None
        position = self._position_from_lsp(params.get("position", {}))
        for ref in document.parsed.references:
            if self._contains(ref.range, position) and ref.resolved_path:
                locations = collect_definition_locations(document.analyzed)
                target_range = locations.get(ref.resolved_path)
                if target_range is not None:
                    return [
                        {
                            "uri": uri,
                            "range": self._range_to_lsp(target_range),
                        }
                    ]
        return None

    def _document_symbol(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        text_document = params.get("textDocument", {})
        uri = text_document.get("uri")
        document = self._documents.get(uri)
        if document is None:
            return []
        items = []
        for path, table in sorted(document.analyzed.table_index.items()):
            items.append(
                {
                    "name": ".".join(path),
                    "kind": 5,
                    "range": self._range_to_lsp(table.header_range),
                    "selectionRange": self._range_to_lsp(table.header_range),
                }
            )
        for path, assignment in sorted(document.analyzed.assignment_index.items()):
            items.append(
                {
                    "name": assignment.key,
                    "kind": 13,
                    "range": self._range_to_lsp(assignment.value_range),
                    "selectionRange": self._range_to_lsp(assignment.key_range),
                }
            )
        return items

    def _workspace_symbol(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        query = (params.get("query") or "").lower()
        items: list[dict[str, Any]] = []
        for uri, document in self._documents.items():
            for path, assignment in document.analyzed.assignment_index.items():
                label = ".".join(path)
                if query and query not in label.lower():
                    continue
                items.append(
                    {
                        "name": label,
                        "kind": 13,
                        "location": {
                            "uri": uri,
                            "range": self._range_to_lsp(assignment.key_range),
                        },
                    }
                )
        return items

    def _range_to_lsp(self, range_: Range) -> dict[str, Any]:
        return {
            "start": {"line": range_.start.line, "character": range_.start.character},
            "end": {"line": range_.end.line, "character": range_.end.character},
        }

    def _position_from_lsp(self, position: dict[str, Any]) -> Position:
        return Position(line=int(position.get("line", 0)), character=int(position.get("character", 0)))

    def _contains(self, range_: Range, position: Position) -> bool:
        if position.line < range_.start.line or position.line > range_.end.line:
            return False
        if range_.start.line == range_.end.line:
            return range_.start.character <= position.character <= range_.end.character
        if position.line == range_.start.line and position.character < range_.start.character:
            return False
        if position.line == range_.end.line and position.character > range_.end.character:
            return False
        return True

    def _uri_to_path(self, uri: str) -> Path | None:
        parsed = urlparse(uri)
        if parsed.scheme != "file":
            return None
        path = url2pathname(unquote(parsed.path))
        if parsed.netloc:
            if path.startswith("/"):
                path = f"//{parsed.netloc}{path}"
            else:
                path = f"//{parsed.netloc}/{path}"
        return Path(path)


class _NoResponseType:
    pass


_NoResponse = _NoResponseType()


def run_server() -> None:
    server = MsraLanguageServer()
    server.run()
