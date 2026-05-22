const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { analyzeDocument } = require("../lsp/analysis");
const { parseDocument } = require("../lsp/parser");
const { collectSemanticTokens } = require("../lsp/semantic-tokens");
const languageConfiguration = require("../language-configuration.json");
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

test("assignment schema flags invalid app keys and timeout value types", () => {
  const text = [
    "[app]",
    "timeout_m=35000",
    'timeout_ms="35000"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///assignment-schema.msra");
  const analysis = analyzeDocument(document);
  const unknownKeyDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unknown-assignment-key");
  const typeDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-assignment-value-type");

  assert.ok(unknownKeyDiagnostic, "expected the misspelled timeout key to be rejected");
  assert.ok(typeDiagnostic, "expected timeout_ms to require an integer value");
  assert.match(unknownKeyDiagnostic.message, /timeout_m/);
  assert.match(typeDiagnostic.message, /Expected integer/);
});

test("enum and pattern schema rules validate app function settings", () => {
  const text = [
    "[app]",
    'class_name_pattern="Service"',
    "[app.warmup]",
    'on_error_screenshot_path="screenshot.txt"',
    "[app.func.A3A417]",
    'method="FETCH"',
    "[app.func.A3A417.headers]",
    'cors_mode="corss"',
    'credentials="maybe"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///enum-pattern-schema.msra");
  const analysis = analyzeDocument(document);

  const diagnostics = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-assignment-value-type");

  assert.strictEqual(diagnostics.length, 5);
  assert.match(diagnostics[0].message, /class_name/i);
  assert.match(diagnostics[1].message, /jpg|jpeg|png/i);
  assert.match(diagnostics[2].message, /GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS/);
  assert.match(diagnostics[3].message, /cors|no-cors|same-origin/);
  assert.match(diagnostics[4].message, /omit|same-origin|include/);
});

test("warmup browser must be one of the supported browsers", () => {
  const text = [
    "[app]",
    "[app.warmup]",
    'browser="ddd"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-browser.msra");
  const analysis = analyzeDocument(document);
  const browserDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-assignment-value-type");

  assert.ok(browserDiagnostic, "expected an invalid browser name to be rejected");
  assert.match(browserDiagnostic.message, /chromium|firefox|webkit|camoufox/);
});

test("body type must be a browser-supported MIME type", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.body]",
    "[app.func.A3A417.body.ANYNAME]",
    'type="ddd"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-body-type.msra");
  const analysis = analyzeDocument(document);
  const typeDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-assignment-value-type");

  assert.ok(typeDiagnostic, "expected an invalid body type to be rejected");
  assert.match(typeDiagnostic.message, /browser-supported MIME type/);
});

test("nested body tables require the parent body item", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.body]",
    "[app.func.A3A417.body.VLOJENNOS2T.ANYNAME2]",
    'type="application/json"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///missing-body-parent.msra");
  const analysis = analyzeDocument(document);
  const parentDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-table-parent");

  assert.ok(parentDiagnostic, "expected a missing parent body table to be reported");
  assert.match(parentDiagnostic.message, /app\.func\.A3A417\.body\.VLOJENNOS2T/);
});

test("function group accepts relative group names and nested group names", () => {
  const text = [
    "[app]",
    "[app.groups.Catalog]",
    "[app.groups.Catalog.Products]",
    "[app.func.A3A417]",
    'group="Catalog.Products"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///valid-group.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("function group rejects the full app.groups prefix", () => {
  const text = [
    "[app]",
    "[app.groups.Catalog]",
    "[app.groups.Catalog.Products]",
    "[app.func.A3A417]",
    'group="app.groups.Catalog"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///missing-group.msra");
  const analysis = analyzeDocument(document);
  const groupDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-group");

  assert.ok(groupDiagnostic, "expected the full app.groups prefix to be rejected");
  assert.match(groupDiagnostic.message, /app\.groups\.Catalog/);
  assert.match(groupDiagnostic.message, /Catalog/);
  assert.match(groupDiagnostic.message, /Catalog\.Products/);
});

test("virtual variable references must resolve to declared variables", () => {
  const text = [
    "[app]",
    "[app.variables.city_id]",
    'types=[{"type"="integer", "revalue"="^[1-9]\\\\d*$"}, {"type"="null", "value"=null}]',
    'description="Идентификатор города"',
    'from=<UNSTANDART_HEADERS.REQUEST.x-city>',
    "",
    "[app.func.A3A417]",
    "[app.func.A3A417.body]",
    "[app.func.A3A417.body.ANYNAME]",
    'type="application/json"',
    "data=<VARIABLES.ity_id>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///unresolved-variable.msra");
  const analysis = analyzeDocument(document);
  const unresolvedDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unresolved-reference");

  assert.ok(unresolvedDiagnostic, "expected the typo in VARIABLES reference to be reported");
  assert.match(unresolvedDiagnostic.message, /VARIABLES\.ity_id/);
});

test("grammar highlights boolean and null keywords", () => {
  const keywordPatterns = grammar.repository.keywords.patterns.map((pattern) => pattern.match);
  assert.deepStrictEqual(keywordPatterns, [
    "\\btrue\\b",
    "\\bfalse\\b",
    "\\bnull\\b",
  ]);
});

test("grammar highlights numeric literals", () => {
  const numberPattern = grammar.repository.numbers.patterns[0];

  assert.strictEqual(numberPattern.name, "constant.numeric.msra");
  assert.match(numberPattern.match, /\\d/);
});

test("grammar splits table paths into system segments, user segments, dots, and quoted literals", () => {
  const assignmentPattern = grammar.repository.assignments.patterns[0];
  const headerPattern = grammar.repository.headers.patterns[0];
  const quotedSegmentPattern = grammar.repository["path-quoted-segment"].patterns[0];

  assert.match(assignmentPattern.match, /[:=]/);
  assert.match(headerPattern.begin, /app\\b/);
  assert.match(headerPattern.begin, /misklerreverseapi\\b/);
  assert.strictEqual(headerPattern.contentName, "meta.path.msra");
  assert.strictEqual(assignmentPattern.name, "keyword.other.attribute-name.msra");
  assert.deepStrictEqual(headerPattern.patterns.map((pattern) => pattern.include), [
    "#path-dots",
    "#path-quoted-segment",
    "#path-system-segment",
    "#path-user-segment",
  ]);
  assert.strictEqual(quotedSegmentPattern.contentName, "variable.other.readwrite.msra");
  assert.strictEqual(quotedSegmentPattern.begin, "(\\\")");
  assert.strictEqual(quotedSegmentPattern.end, "(\\\")");
  assert.match(grammar.repository["path-dots"].patterns[0].name, /punctuation\.separator\.period/);
  assert.match(grammar.repository["path-system-segment"].patterns[0].match, /app/);
  assert.strictEqual(grammar.repository["path-user-segment"].patterns[0].name, "variable.other.readwrite.msra");
  assert.match(grammar.repository["path-user-segment"].patterns[0].match, /A-Za-z_/);
});

test("grammar splits reference paths into system segments, user segments, dots, and quoted literals", () => {
  const refPattern = grammar.repository.refs.patterns[0];
  const systemPattern = grammar.repository["path-system-segment"].patterns[0];

  assert.strictEqual(refPattern.begin, "(<)");
  assert.strictEqual(refPattern.end, "(>)");
  assert.strictEqual(refPattern.contentName, "meta.reference.path.msra");
  assert.deepStrictEqual(refPattern.patterns.map((pattern) => pattern.include), [
    "#path-dots",
    "#path-quoted-segment",
    "#path-system-segment",
    "#path-user-segment",
  ]);
  assert.match(systemPattern.match, /DOCUMENT/);
  assert.match(systemPattern.match, /REGEXES/);
  assert.match(systemPattern.match, /VARIABLES/);
  assert.match(systemPattern.match, /INPUT/);
  assert.ok(!systemPattern.match.includes("TEXT_REQUEST"), "TEXT_REQUEST should remain a user segment");
});

test("grammar distinguishes path segments, assignment keys, and inline table keys", () => {
  const inlineTablePattern = grammar.repository["inline-tables"].patterns[0];
  const inlineKeyPatterns = grammar.repository["inline-table-keys"].patterns;

  assert.strictEqual(grammar.repository.assignments.patterns[0].name, "keyword.other.attribute-name.msra");
  assert.strictEqual(grammar.repository["path-user-segment"].patterns[0].name, "variable.other.readwrite.msra");
  assert.strictEqual(grammar.repository["path-quoted-segment"].patterns[0].contentName, "variable.other.readwrite.msra");
  assert.strictEqual(inlineTablePattern.begin, "(\\{)");
  assert.strictEqual(inlineTablePattern.end, "(\\})");
  assert.deepStrictEqual(inlineTablePattern.patterns.map((pattern) => pattern.include), [
    "#comments",
    "#inline-table-keys",
    "#refs",
    "#keywords",
    "#numbers",
    "#inline-tables",
    "#strings",
  ]);
  assert.strictEqual(inlineKeyPatterns[0].name, "support.type.property-name.msra");
  assert.strictEqual(inlineKeyPatterns[1].name, "support.type.property-name.msra");
});

test("package contributes a stable MSRA palette", () => {
  const defaults = require("../package.json").contributes.configurationDefaults;
  const semanticRules = defaults["editor.semanticTokenColorCustomizations"].rules;
  const tokenRules = defaults["editor.tokenColorCustomizations"].textMateRules;
  const scopeToColor = new Map(tokenRules.map((rule) => [rule.scope, rule.settings.foreground]));

  assert.strictEqual(defaults["[msra]"]["editor.semanticHighlighting.enabled"], true);
  assert.strictEqual(semanticRules["namespace.msra"].foreground, "#56B6C2");
  assert.strictEqual(semanticRules["parameter.msra"].foreground, "#61AFEF");
  assert.strictEqual(semanticRules["property.msra"].foreground, "#E5C07B");
  assert.strictEqual(semanticRules["enumMember.msra"].foreground, "#98C379");
  assert.strictEqual(scopeToColor.get("keyword.other.attribute-name.msra"), "#E5C07B");
  assert.strictEqual(scopeToColor.get("support.type.property-name.msra"), "#98C379");
  assert.strictEqual(scopeToColor.get("keyword.other.namespace.msra"), "#56B6C2");
  assert.strictEqual(scopeToColor.get("variable.other.readwrite.msra"), "#61AFEF");
  assert.strictEqual(scopeToColor.get("string.quoted.double.msra"), "#CE9178");
  assert.strictEqual(scopeToColor.get("constant.numeric.msra"), "#D19A66");
});

test("semantic tokens separate path segments, assignment keys, and inline table keys", () => {
  const text = [
    "[app.func.A3A417.body.ANYNAME]",
    'type="application/json"',
    "return_name=true",
    'data={"key": <VARIABLES.city_id>, "key2": "value", "key3": <INPUT.query>}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///semantic-tokens.msra");
  const tokens = collectSemanticTokens(document);

  const findToken = (needle, tokenType) => tokens.find((token) => {
    if (token.tokenType !== tokenType) {
      return false;
    }
    const start = document.offsetAt({ line: token.line, character: token.character });
    const end = start + token.length;
    return text.slice(start, end) === needle;
  });

  for (const needle of ["A3A417", "ANYNAME", "city_id", "query"]) {
    assert.ok(findToken(needle, "parameter"), `expected ${needle} to be classified as a path/user segment`);
  }
  for (const needle of ["type", "return_name", "data"]) {
    assert.ok(findToken(needle, "property"), `expected ${needle} to be classified as an assignment key`);
  }
  for (const needle of ["key", "key2", "key3"]) {
    assert.ok(findToken(needle, "enumMember"), `expected ${needle} to be classified as an inline-table key`);
  }
  assert.ok(findToken("app", "namespace"), "expected app to be classified as a system segment");
  assert.ok(findToken("body", "namespace"), "expected body to be classified as a system segment");
  assert.ok(tokens.every((token) => token.tokenModifiers.includes("msra")), "expected all semantic tokens to carry the msra modifier");
});

test("semantic tokens color app prefixes keys differently from fixed assignment keys", () => {
  const text = [
    "[app.prefixes]",
    'BASE_API="https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2"',
    'ORIGIN="https://www.ozon.ru/"',
    "[app]",
    "timeout_ms=35000",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///prefixes-semantic.msra");
  const tokens = collectSemanticTokens(document);

  const findToken = (needle, tokenType) => tokens.find((token) => {
    if (token.tokenType !== tokenType) {
      return false;
    }
    const start = document.offsetAt({ line: token.line, character: token.character });
    const end = start + token.length;
    return text.slice(start, end) === needle;
  });

  assert.ok(findToken("BASE_API", "enumMember"), "expected BASE_API to be classified as a custom prefix key");
  assert.ok(findToken("ORIGIN", "enumMember"), "expected ORIGIN to be classified as a custom prefix key");
  assert.ok(findToken("timeout_ms", "property"), "expected timeout_ms to remain a fixed assignment key");
});

test("language configuration keeps brackets out of comments and strings", () => {
  const bracketPairs = languageConfiguration.autoClosingPairs.filter((pair) => ["{", "[", "(", "<"].includes(pair.open));
  const quotePair = languageConfiguration.autoClosingPairs.find((pair) => pair.open === "\"");
  const unbalancedScopes = new Set(require("../package.json").contributes.grammars[0].unbalancedBracketScopes || []);

  assert.ok(bracketPairs.every((pair) => Array.isArray(pair.notIn) && pair.notIn.includes("comment") && pair.notIn.includes("string")));
  assert.ok(Array.isArray(quotePair?.notIn) && quotePair.notIn.includes("comment") && quotePair.notIn.includes("string"));
  assert.ok(unbalancedScopes.has("comment"));
  assert.ok(unbalancedScopes.has("string"));
  assert.ok(unbalancedScopes.has("meta.path.segment.quoted"));
});
