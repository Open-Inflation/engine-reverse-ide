const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { analyzeDocument } = require("../lsp/analysis");
const { parseDocument } = require("../lsp/parser");
const grammar = require("../syntaxes/msra.tmLanguage.json");

test("example document stays valid and keeps the documented path", () => {
  const examplePath = path.resolve(__dirname, "..", "..", "example.msra");
  const text = readFileSync(examplePath, "utf8");
  const document = parseDocument(text, examplePath);
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
  assert.ok(
    document.tables.has(JSON.stringify(["app", "func", "A3A417", "url", "params", "from_global", "params", "text"])),
    "expected the nested url params table from the example file to be indexed",
  );
});

test("quoted reserved body names remain valid", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.body]",
    '[app.func.A3A417.body."url"]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///quoted-body.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("nested params tables reject extra children", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.from_global]",
    "[app.func.A3A417.url.params.from_global.params.text]",
    "[app.func.A3A417.url.params.from_global.params.text.extra]",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-params.msra");
  const analysis = analyzeDocument(document);
  const invalidPathDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-table-path");

  assert.ok(invalidPathDiagnostic, "expected hard table-path validation to flag the extra nested child");
  assert.match(
    invalidPathDiagnostic.message,
    /nested "params" namespace after parameter "text"/,
  );
});

test("grammar highlights boolean and null keywords", () => {
  const keywordPatterns = grammar.repository.keywords.patterns.map((pattern) => pattern.match);
  assert.deepStrictEqual(keywordPatterns, [
    "\\btrue\\b",
    "\\bfalse\\b",
    "\\bnull\\b",
  ]);
});
