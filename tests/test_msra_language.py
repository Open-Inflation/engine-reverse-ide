from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from msra_lsp.analysis import analyze_document  # noqa: E402
from msra_lsp.cli import build_parser, main  # noqa: E402
from msra_lsp.parser import parse_document  # noqa: E402
from msra_lsp.server import MsraLanguageServer  # noqa: E402


class MsraLanguageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.example_path = ROOT / "example.msra"
        self.text = self.example_path.read_text(encoding="utf-8")
        self.document = parse_document(self.text, uri=self.example_path.resolve().as_uri())
        self.analysis = analyze_document(self.document)

    def test_example_parses_without_diagnostics(self) -> None:
        self.assertEqual([], self.analysis.diagnostics)
        self.assertGreater(len(self.document.tables), 0)
        self.assertGreater(len(self.document.assignments), 0)
        self.assertGreater(len(self.document.references), 0)

    def test_trailing_identifier_after_value_is_rejected(self) -> None:
        text = "[app]\nname=\"OzonAPI\"m\n"
        document = parse_document(text, uri="file:///tmp/bad.msra")
        analyzed = analyze_document(document)
        self.assertTrue(any(d.code == "trailing-assignment" for d in analyzed.diagnostics))

    def test_hotfix_paths_exist(self) -> None:
        self.assertIn(("app", "prefixes", "ORIGIN"), self.document.assignments)
        self.assertIn(("app", "func", "A3A417", "url", "params", "from_global", "params", "text"), self.document.tables)
        self.assertIn(("app", "regexes", "TEXT_REQUEST"), self.document.tables)

    def test_virtual_references_resolve(self) -> None:
        resolved = {ref.resolved_path for ref in self.document.references}
        self.assertIn(("app", "prefixes", "ORIGIN"), resolved)
        self.assertIn(("app", "regexes", "TEXT_REQUEST"), resolved)
        self.assertIn(("app", "func", "A3A417", "input", "query"), resolved)

    def test_server_uses_open_document_text(self) -> None:
        server = MsraLanguageServer()
        uri = "file:///nowhere/test.msra"
        server._update_document(
            {
                "textDocument": {
                    "uri": uri,
                    "languageId": "msra",
                    "version": 1,
                    "text": "[app]\nfoo = { a = 1\n",
                }
            },
            publish=False,
        )
        self.assertIn(uri, server._documents)
        diagnostics = server._documents[uri].analyzed.diagnostics
        self.assertTrue(any(d.code == "expected-rbrace" for d in diagnostics))

    def test_server_accepts_stdio_flag(self) -> None:
        args = build_parser().parse_args(["server", "--stdio"])
        self.assertTrue(args.stdio)

    def test_main_with_stdio_routes_to_server(self) -> None:
        with patch("msra_lsp.cli.run_server", return_value=None) as run_server:
            code = main(["--stdio"])
        self.assertEqual(code, 0)
        run_server.assert_called_once()


if __name__ == "__main__":
    unittest.main()
