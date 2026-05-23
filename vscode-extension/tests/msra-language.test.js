const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { analyzeDocument } = require("../lsp/analysis");
const { parseDocument } = require("../lsp/parser");
const { MsraLanguageServer } = require("../lsp/server");
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
  assert.match(typeDiagnostic.message, /non-negative integer/);
});

test("app name must not contain spaces", () => {
  const text = [
    "[app]",
    'name="FixPrice API"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-app-name.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-assignment-value-type");

  assert.ok(diagnostic, "expected app.name with spaces to be rejected");
  assert.match(diagnostic.message, /without spaces/);
});

test("app metadata accepts authors description and license", () => {
  const text = [
    "[app]",
    'name="OzonAPI"',
    'authors=[{name="Miskler", email="miskler@gmail.com"}, {name="Another Author", email="author@example.com"}]',
    'description="Ozon API integration for catalog browsing and cart flows"',
    'license="GPL-3.0-or-later"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///app-metadata.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("app metadata rejects malformed authors and license values", () => {
  const text = [
    "[app]",
    'authors=[{name="Miskler"}]',
    'license="GNU General Public License"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-app-metadata.msra");
  const analysis = analyzeDocument(document);
  const missingEmail = analysis.diagnostics.find((item) => item.code === "missing-inline-table-key");
  const invalidLicense = analysis.diagnostics.find((item) => item.code === "invalid-assignment-value-type");

  assert.ok(missingEmail, "expected authors entries to require an email");
  assert.match(missingEmail.message, /email/);
  assert.ok(invalidLicense, "expected app.license to require a short license identifier");
  assert.match(invalidLicense.message, /license abbreviation/);
});

test("timeout_ms must be a non-negative integer", () => {
  const text = [
    "[app]",
    "timeout_ms=-35000",
    "[app.warmup]",
    "timeout_ms=-1",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///negative-timeout.msra");
  const analysis = analyzeDocument(document);
  const diagnostics = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-assignment-value-type");

  assert.strictEqual(diagnostics.length, 2);
  assert.match(diagnostics[0].message, /non-negative integer/);
  assert.match(diagnostics[0].message, /-35000/);
  assert.match(diagnostics[1].message, /non-negative integer/);
  assert.match(diagnostics[1].message, /-1/);
});

test("enum and pattern schema rules validate app function settings", () => {
  const text = [
    "[app]",
    'class_name_pattern="Service"',
    "[app.warmup]",
    'on_error_screenshot_path="screenshot.txt"',
    "[app.func.A3A417]",
    'method=FETCH',
    "[app.func.A3A417.headers]",
    'cors_mode=corss',
    'credentials=maybe',
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

test("function transport validates its enum and forbids method for goto", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    'transport=websocket',
    'method=GET',
    "",
    "[app.func.A3A418]",
    'transport=goto',
    'method=POST',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///function-transport.msra");
  const analysis = analyzeDocument(document);

  const invalidTransport = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-assignment-value-type");
  const unexpectedMethod = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unexpected-function-method");

  assert.ok(invalidTransport, "expected an unsupported transport value to be rejected");
  assert.match(invalidTransport.message, /direct|fetch|goto/);
  assert.ok(unexpectedMethod, "expected method to be rejected for goto transport");
  assert.match(unexpectedMethod.message, /transport="goto"/);
  assert.match(unexpectedMethod.message, /method/);
});

test("render_html is only valid inside postprocess", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    'transport=fetch',
    'render_html=true',
    "",
    "[app.func.A3A417.postprocess]",
    "render_html=true",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///render-html-placement.msra");
  const analysis = analyzeDocument(document);

  const rootDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unknown-assignment-key");
  assert.ok(rootDiagnostic, "expected render_html on the root function table to be rejected");
  assert.match(rootDiagnostic.message, /render_html/);
});

test("function postprocess validates goto_pipeline and evaluate context", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    'transport=fetch',
    "[app.func.A3A417.postprocess]",
    "render_html=false",
    'goto_pipeline=[{action=wait_network, state=idle}]',
    'evaluate="script.js"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///function-postprocess-context.msra");
  const analysis = analyzeDocument(document);

  const gotoPipelineDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unexpected-function-goto-pipeline");
  const evaluateDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-function-render-html");

  assert.ok(gotoPipelineDiagnostic, "expected goto_pipeline to be rejected outside transport=goto");
  assert.match(gotoPipelineDiagnostic.message, /goto_pipeline/);
  assert.ok(evaluateDiagnostic, "expected evaluate to require render_html=true for fetch/direct transports");
  assert.match(evaluateDiagnostic.message, /render_html=true/);
});

test("regex actions validate action enums and replace arguments", () => {
  const text = [
    "[app]",
    "[app.regexes.TEXT_REQUEST]",
    'regex="^[a-zа-яё+]+$"',
    'actions=[{action=lower}, {action=replace, what=" ", with="+"}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///valid-regex-actions.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("regex actions reject unknown action names and missing replace arguments", () => {
  const text = [
    "[app]",
    "[app.regexes.TEXT_REQUEST]",
    'regex="^[a-zа-яё+]+$"',
    'actions=[{action=lowerr}, {action=replace, what=" "}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-regex-actions.msra");
  const analysis = analyzeDocument(document);
  const invalidActionDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-assignment-value-type");
  const missingWithDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-conditional-inline-table-key");

  assert.ok(invalidActionDiagnostic, "expected unknown regex actions to be rejected");
  assert.ok(missingWithDiagnostic, "expected replace actions to require the with argument");
  assert.match(invalidActionDiagnostic.message, /lower|upper|capitalize|trim|replace/);
  assert.match(missingWithDiagnostic.message, /with/);
  assert.match(missingWithDiagnostic.message, /replace/);
});

test("nested example, values, list_style, and types structures are validated strictly", () => {
  const text = [
    "[app]",
    "[app.variables.city_id]",
    'types=[{"revalue"={from=1, to=27}}]',
    "read_only=false",
    "[app.func.A3A417]",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    'list_style={style=repeat, delimiter=1, indexed=false, extra=true}',
    'values=[{"foo"=1}]',
    "",
    "[app.func.A3A417.input.query]",
    'type=string',
    "",
    "[app.func.A3A417.examples]",
    'examples=[{"inputs"={"query"="example"}, "test"=false}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///strict-nested-structures.msra");
  const analysis = analyzeDocument(document);

  const missingType = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-inline-table-key" && /type/.test(diagnostic.message));
  const badDelimiter = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-assignment-value-type" && /delimiter|stringish|string/i.test(diagnostic.message));
  const unknownListStyleKey = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unknown-inline-table-key" && /extra/.test(diagnostic.message));
  const unknownValuesKey = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unknown-inline-table-key" && /foo/.test(diagnostic.message));
  const missingExampleFile = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-inline-table-key" && /file/.test(diagnostic.message));

  assert.ok(missingType, "expected a missing type field inside app.variables.city_id.types");
  assert.ok(badDelimiter, "expected a non-string delimiter inside list_style to be rejected");
  assert.ok(unknownListStyleKey, "expected unexpected list_style keys to be rejected");
  assert.ok(unknownValuesKey, "expected unexpected values keys to be rejected");
  assert.ok(missingExampleFile, "expected examples items to require file");
});

test("examples inputs must reference declared function inputs", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.examples]",
    'examples=[{"inputs"={"query"="example"}, "file"="local1.json"}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///missing-example-input.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "missing-example-input");

  assert.ok(diagnostic, "expected example inputs to reject undeclared function inputs");
  assert.match(diagnostic.message, /query/);
});

test("variable type items reject value and revalue together", () => {
  const text = [
    "[app]",
    "[app.variables.city_id]",
    'types=[{"type"=integer, "value"=null, "revalue"={from=1, to=27}}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///conflicting-variable-type-value-revalue.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "conflicting-inline-table-keys");

  assert.ok(diagnostic, "expected value and revalue to conflict inside variable type items");
  assert.match(diagnostic.message, /value/);
  assert.match(diagnostic.message, /revalue/);
});

test("read_only on app.variables must be boolean", () => {
  const text = [
    "[app]",
    "[app.variables.city_id]",
    'types=[{"type"=integer}]',
    'read_only="false"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-variable-read-only.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-assignment-value-type");

  assert.ok(diagnostic, "expected read_only to reject string values");
  assert.match(diagnostic.message, /boolean/i);
});

test("values and revalue cannot coexist in input and url params tables", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type=string',
    'values=["one", "two"]',
    'revalue={from=1, to=27}',
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    'values=[{"value_in_url"="/search", "value"="search"}]',
    'revalue={from=1, to=27}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///conflicting-values-revalue.msra");
  const analysis = analyzeDocument(document);
  const conflictDiagnostics = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "conflicting-assignment-keys");

  assert.strictEqual(conflictDiagnostics.length, 2);
  assert.match(conflictDiagnostics[0].message, /values/);
  assert.match(conflictDiagnostics[0].message, /revalue/);
  assert.match(conflictDiagnostics[1].message, /values/);
  assert.match(conflictDiagnostics[1].message, /revalue/);
});

test("string revalue syntax is rejected in favor of reference or numeric range form", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type=string',
    'revalue="^[a-z]+$"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///string-revalue-is-invalid.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-assignment-value-type");

  assert.ok(diagnostic, "expected string revalue syntax to be rejected");
  assert.match(diagnostic.message, /reference <\.\.\.>|numeric range/i);
});

test("reference revalue syntax is accepted", () => {
  const text = [
    "[app]",
    "[app.regexes.TEXT_REQUEST]",
    'regex="^[a-z]+$"',
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type=string',
    'revalue=<DOCUMENT.REGEXES.TEXT_REQUEST>',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///reference-revalue-is-valid.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("inline regex object revalue syntax is rejected in favor of reference or numeric range form", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type=string',
    'revalue={regex="^[a-z]+$"}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///inline-regex-revalue-is-invalid.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-assignment-value-type");

  assert.ok(diagnostic, "expected inline regex object syntax to be rejected");
  assert.match(diagnostic.message, /reference <\.\.\.>|numeric range/i);
});

test("pipeline state is validated in the context of action", () => {
  const text = [
    "[app]",
    "[app.warmup]",
    'pipeline=[{action=wait_sniffer, what=<UNSTANDART_HEADERS.REQUEST.X-key>}, {action=wait_element, state=visible, what="div.page-content"}, {action=wait_network, state=idle}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///valid-pipeline-state.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("pipeline state rejects values that do not match the action context", () => {
  const text = [
    "[app]",
    "[app.warmup]",
    'pipeline=[{action=wait_sniffer, state=visible}, {action=wait_element, state=idle, what="div.page-content"}, {action=wait_network, state=visible}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-pipeline-state.msra");
  const analysis = analyzeDocument(document);
  const invalidStateDiagnostics = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-assignment-value-type");

  assert.strictEqual(invalidStateDiagnostics.length, 3, "expected each pipeline item to fail validation when the state does not match its action context");
  assert.ok(invalidStateDiagnostics.every((diagnostic) => /Expected one of:/.test(diagnostic.message)));
});

test("url param values require value unless default=true is present", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    'values=[{"value_in_url"="/searchSuggestions/search/"}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///missing-url-param-value.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "missing-url-param-value");

  assert.ok(diagnostic, "expected values entries without value or default=true to be rejected");
  assert.match(diagnostic.message, /value/);
  assert.match(diagnostic.message, /default=true/);
});

test("list url params reject non-list inputs in data", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type=string',
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    "list=true",
    "data=<INPUT.query>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-list-url-param-input.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-url-param-list-input-type");

  assert.ok(diagnostic, "expected list url params to reject non-list inputs in data");
  assert.match(diagnostic.message, /list=true/);
  assert.match(diagnostic.message, /INPUT\.query/);
});

test("list url params accept list-typed inputs in data", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    "type=list[string]",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    "list=true",
    "data=<INPUT.query>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///valid-list-url-param-input.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("quoted list types are rejected for inputs", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type="list[string]"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///quoted-list-type.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-assignment-value-type");

  assert.ok(diagnostic, "expected quoted list types to be rejected");
  assert.match(diagnostic.message, /list\[type\]/i);
});

test("numeric revalue ranges accept integer and float bounds", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.limit]",
    'type=integer',
    'revalue={from=1, to=27}',
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.ratio]",
    'revalue={from=0.5, to=2.5}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///numeric-revalue-ranges.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("numeric revalue ranges require ordered bounds", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.limit]",
    'type=integer',
    'revalue={from=27, to=1}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-numeric-revalue-range.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-inline-table-value-order");

  assert.ok(diagnostic, "expected numeric range bounds to remain ordered");
  assert.match(diagnostic.message, /numeric range/);
});

test("app browser must be one of the supported browsers", () => {
  const text = [
    "[app]",
    'browser=ddd',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-browser.msra");
  const analysis = analyzeDocument(document);
  const browserDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-assignment-value-type");

  assert.ok(browserDiagnostic, "expected an invalid browser name to be rejected");
  assert.match(browserDiagnostic.message, /chromium|firefox|webkit|camoufox/);
});

test("warmup humanize options require camoufox browser", () => {
  const text = [
    "[app]",
    'browser=chromium',
    "[app.warmup]",
    "humanize=true",
    "block_images=true",
    'humanize_action={from=1000, to=3000}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-warmup-context.msra");
  const analysis = analyzeDocument(document);
  const diagnostics = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-warmup-context");

  assert.strictEqual(diagnostics.length, 3);
  assert.match(diagnostics[0].message, /camoufox/);
});

test("warmup humanize accepts positive numbers when camoufox is enabled", () => {
  const text = [
    "[app]",
    'browser=camoufox',
    "[app.warmup]",
    "humanize=0.5",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///valid-humanize-number.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("warmup rejects unsupported keys like wait_url", () => {
  const text = [
    "[app]",
    "[app.warmup]",
    'wait_url="https://example.com"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///unsupported-warmup-key.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "unknown-assignment-key");

  assert.ok(diagnostic, "expected wait_url to be rejected as an unsupported warmup key");
  assert.match(diagnostic.message, /wait_url/);
});

test("generator merges consecutive warmup test steps into a single test_mode guard", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-pipeline-"));
  const inputPath = path.join(workDir, "pipeline.msra");
  const outputDir = path.join(workDir, "generated");
  const packageName = "testpkg";
  const text = [
    "[app]",
    'name="PipelineApp"',
    'version="0.1.0"',
    "timeout_ms=1000",
    'browser=camoufox',
    'class_name_pattern="Class{class_name}"',
    'description=""',
    "",
    "[app.prefixes]",
    'MAIN_SITE_URL="https://example.com/"',
    "",
    "[app.warmup]",
    'url=<DOCUMENT.PREFIXES.MAIN_SITE_URL>',
    'pipeline=[{for_tests=true, action=wait_network, state=load}, {for_tests=true, action=wait_element, state=visible, what="div.one", then=click}, {action=wait_network, state=idle}]',
    "",
  ].join("\n");

  try {
    writeFileSync(inputPath, text, "utf8");
    const result = spawnSync("python", ["-m", "msra_codegen", inputPath, "-o", outputDir, "-p", packageName], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const managerText = readFileSync(path.join(outputDir, packageName, "manager.py"), "utf8");
    const guardCount = (managerText.match(/if self\.test_mode:/g) || []).length;
    assert.strictEqual(guardCount, 1, "expected consecutive test-only steps to share a single test_mode guard");
    assert.match(managerText, /_MAIN_SITE_URL: str = 'https:\/\/example\.com\/'/);
    assert.match(managerText, /self\._MAIN_SITE_URL/);
    assert.match(managerText, /wait_for_load_state\('load'\)/);
    assert.match(managerText, /wait_for_selector\(/);
    assert.match(managerText, /locator = self\.page\.locator\('div\.one'\)\.first/);
    assert.match(managerText, /await locator\.click\(timeout=self\.timeout_ms\)/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
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

test("multipart bodies require a boundary value", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.body]",
    'type="multipart/form-data"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///missing-boundary.msra");
  const analysis = analyzeDocument(document);
  const boundaryDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-body-boundary");

  assert.ok(boundaryDiagnostic, "expected multipart/form-data to require a boundary");
  assert.match(boundaryDiagnostic.message, /boundary/);
});

test("non-multipart bodies cannot define a boundary", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.body]",
    'type="application/json"',
    'boundary="oops"',
    'data={"key"="value"}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///unexpected-boundary.msra");
  const analysis = analyzeDocument(document);
  const boundaryDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unexpected-body-boundary");

  assert.ok(boundaryDiagnostic, "expected a boundary outside multipart/form-data to be rejected");
  assert.match(boundaryDiagnostic.message, /multipart\/form-data/);
});

test("urlencoded bodies require data or a nested url table", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.body]",
    'type="application/x-www-form-urlencoded"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///missing-urlencoded-payload.msra");
  const analysis = analyzeDocument(document);
  const payloadDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-body-payload");

  assert.ok(payloadDiagnostic, "expected x-www-form-urlencoded bodies to require data or a url table");
  assert.match(payloadDiagnostic.message, /data/);
  assert.match(payloadDiagnostic.message, /url/);
});

test("shared function headers accept referrer cors_mode credentials and headers", () => {
  const text = [
    "[app]",
    "[app.prefixes]",
    'ORIGIN="https://www.ozon.ru/"',
    "[app.func.headers]",
    'referrer=<DOCUMENT.PREFIXES.ORIGIN>',
    'cors_mode=cors',
    'credentials=include',
    "headers=<UNSTANDART_HEADERS>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///shared-headers.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
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

test("url param values cannot define multiple defaults unless list=true", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    'list=false',
    'values=[{"value_in_url"="/search", "default"=true}, {"value_in_url"="/search-alt", "default"=true}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///duplicate-url-param-default.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "duplicate-url-param-default");

  assert.ok(diagnostic, "expected duplicate defaults to be rejected when list=false");
  assert.match(diagnostic.message, /list=true/);
});

test("function group accepts group references and nested group references", () => {
  const text = [
    "[app]",
    "[app.groups.Catalog]",
    "[app.groups.Catalog.Product]",
    "[app.func.A3A417]",
    'group=<GROUPS.Catalog.Product>',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///valid-group.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("function group rejects string links and unresolved group references", () => {
  const text = [
    "[app]",
    "[app.groups.Catalog]",
    "[app.groups.Catalog.Product]",
    "[app.func.A3A417]",
    'group="app.groups.Catalog"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///missing-group.msra");
  const analysis = analyzeDocument(document);
  const groupDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-assignment-value-type");

  assert.ok(groupDiagnostic, "expected string-based group links to be rejected");
  assert.match(groupDiagnostic.message, /reference/i);
  assert.match(groupDiagnostic.message, /GROUPS/i);
});

test("group references must point to existing app.groups tables", () => {
  const text = [
    "[app]",
    "[app.groups.Catalog]",
    "[app.groups.Catalog.Product]",
    "[app.func.A3A417]",
    'group=<GROUPS.Catalog.Products>',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///missing-group-reference.msra");
  const analysis = analyzeDocument(document);
  const groupDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-group");

  assert.ok(groupDiagnostic, "expected unresolved group references inside GROUPS to be rejected");
  assert.match(groupDiagnostic.message, /Catalog\.Products/);
  assert.match(groupDiagnostic.message, /Catalog\.Product/);
});

test("virtual variable references must resolve to declared variables", () => {
  const text = [
    "[app]",
    "[app.variables.city_id]",
    'types=[{"type"=integer, "revalue"={from=1, to=27}}, {"type"=null, "value"=null}]',
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

test("grammar treats number-sign comments as a full-line scope", () => {
  const commentPattern = grammar.repository.comments.patterns[0];

  assert.strictEqual(commentPattern.name, "comment.line.number-sign.msra");
  assert.strictEqual(commentPattern.begin, "#");
  assert.strictEqual(commentPattern.end, "$");
  assert.deepStrictEqual(commentPattern.patterns, []);
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
    "#bare-values",
    "#inline-tables",
    "#strings",
  ]);
  assert.strictEqual(inlineKeyPatterns[0].name, "support.type.property-name.msra");
  assert.strictEqual(inlineKeyPatterns[1].name, "support.type.property-name.msra");
});

test("grammar highlights bare field values", () => {
  const bareValuePattern = grammar.repository["bare-values"].patterns[0];

  assert.strictEqual(bareValuePattern.name, undefined);
  assert.strictEqual(bareValuePattern.captures[2].name, "constant.other.bare-value.msra");
  assert.match(bareValuePattern.match, /[=,:\\[]/);
});

test("grammar treats prefixes as a dedicated visual section", () => {
  const prefixSectionPatterns = grammar.repository["prefix-sections"].patterns;
  const prefixAssignmentPattern = grammar.repository["prefix-section-assignments"].patterns[0];

  assert.strictEqual(prefixSectionPatterns.length, 1);
  assert.strictEqual(prefixSectionPatterns[0].name, "meta.section.prefix.msra");
  assert.strictEqual(prefixSectionPatterns[0].contentName, "meta.section.content.prefix.msra");
  assert.strictEqual(prefixSectionPatterns[0].beginCaptures[5].name, "keyword.other.namespace.msra");
  assert.strictEqual(prefixAssignmentPattern.name, "entity.name.variable.prefix.msra");
});

test("package contributes a stable MSRA palette", () => {
  const defaults = require("../package.json").contributes.configurationDefaults;
  const activationEvents = require("../package.json").activationEvents;
  const grammarContribution = require("../package.json").contributes.grammars[0];
  const semanticRules = defaults["editor.semanticTokenColorCustomizations"].rules;
  const tokenRules = defaults["editor.tokenColorCustomizations"].textMateRules;
  const scopeToColor = new Map(tokenRules.map((rule) => [rule.scope, rule.settings.foreground]));

  assert.ok(activationEvents.includes("*"));
  assert.strictEqual(defaults["[msra]"]["editor.semanticHighlighting.enabled"], true);
  assert.strictEqual(semanticRules["namespace.msra"].foreground, "#56B6C2");
  assert.strictEqual(semanticRules["parameter.msra"].foreground, "#61AFEF");
  assert.strictEqual(semanticRules["property.msra"].foreground, "#E5C07B");
  assert.strictEqual(semanticRules["enumMember.msra"].foreground, "#98C379");
  assert.strictEqual(semanticRules["literal.msra"].foreground, "#D19A66");
  assert.strictEqual(scopeToColor.get("keyword.other.attribute-name.msra"), "#E5C07B");
  assert.strictEqual(scopeToColor.get("entity.name.variable.prefix.msra"), "#C678DD");
  assert.strictEqual(scopeToColor.get("support.type.property-name.msra"), "#98C379");
  assert.strictEqual(scopeToColor.get("constant.other.bare-value.msra"), "#D19A66");
  assert.strictEqual(scopeToColor.get("keyword.other.namespace.msra"), "#56B6C2");
  assert.strictEqual(scopeToColor.get("variable.other.readwrite.msra"), "#61AFEF");
  assert.strictEqual(scopeToColor.get("string.quoted.double.msra"), "#CE9178");
  assert.strictEqual(scopeToColor.get("constant.numeric.msra"), "#D19A66");
  assert.strictEqual(semanticRules["variable.msra"].foreground, "#C678DD");
  assert.strictEqual(grammarContribution.tokenTypes["comment.line.number-sign.msra"], "comment");
  assert.strictEqual(grammarContribution.tokenTypes["string.quoted.double.msra"], "string");
  assert.strictEqual(grammarContribution.tokenTypes["meta.path.segment.quoted.msra"], "string");
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
    "[app.func.A3A417]",
    "[app.func.A3A417.url]",
    'base=<DOCUMENT.PREFIXES.BASE_API>"/v1/product/in/"<INPUT.category_alias>',
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
  const findTokens = (needle, tokenType) => tokens.filter((token) => {
    if (token.tokenType !== tokenType) {
      return false;
    }
    const start = document.offsetAt({ line: token.line, character: token.character });
    const end = start + token.length;
    return text.slice(start, end) === needle;
  });

  assert.ok(findToken("BASE_API", "variable"), "expected BASE_API to be classified as a custom prefix variable");
  assert.ok(findToken("ORIGIN", "variable"), "expected ORIGIN to be classified as a custom prefix variable");
  assert.ok(findTokens("BASE_API", "variable").length >= 2, "expected the prefix reference to keep the same variable coloring");
  assert.ok(findToken("timeout_ms", "property"), "expected timeout_ms to remain a fixed assignment key");
});

test("semantic tokens color bare field values as literals", () => {
  const text = [
    "[app]",
    "browser=camoufox",
    "[app.func.A3A417]",
    "transport=fetch",
    "method=GET",
    "[app.func.A3A417.input.query]",
    "type=list[string]",
    "values=[foo, bar]",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///bare-field-values.msra");
  const tokens = collectSemanticTokens(document);

  const findToken = (needle, tokenType) => tokens.find((token) => {
    if (token.tokenType !== tokenType) {
      return false;
    }
    const start = document.offsetAt({ line: token.line, character: token.character });
    const end = start + token.length;
    return text.slice(start, end) === needle;
  });

  for (const needle of ["camoufox", "fetch", "GET", "list", "string", "foo", "bar"]) {
    assert.ok(findToken(needle, "literal"), `expected ${needle} to be classified as a bare field value`);
  }
});

test("completion replaces typed reference prefixes instead of duplicating them", () => {
  const getCompletionItem = (lineText, label) => {
    const server = new MsraLanguageServer({
      onRequest() {},
      onNotification() {},
      listen() {},
      sendNotification() {},
    });
    const uri = `file:///completion-${label.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.msra`;
    const text = ["[app]", "", lineText, ""].join("\n");
    server._updateDocument({ textDocument: { uri, text } }, false);

    const response = server._completion({
      textDocument: { uri },
      position: {
        line: 2,
        character: lineText.length,
      },
    });
    const item = response.items.find((candidate) => candidate.label === label);
    assert.ok(item, `expected completion item ${label}`);
    return item;
  };

  const prefixItem = getCompletionItem("url=<DOCUMENT.PREFIXE", "DOCUMENT.PREFIXES");
  assert.deepStrictEqual(prefixItem.textEdit, {
    range: {
      start: { line: 2, character: 5 },
      end: { line: 2, character: "url=<DOCUMENT.PREFIXE".length },
    },
    newText: "DOCUMENT.PREFIXES",
  });

  const dottedItem = getCompletionItem("url=<DOCUMENT.PREFIXES.", "DOCUMENT.PREFIXES.BASE_API");
  assert.deepStrictEqual(dottedItem.textEdit, {
    range: {
      start: { line: 2, character: 5 },
      end: { line: 2, character: "url=<DOCUMENT.PREFIXES.".length },
    },
    newText: "DOCUMENT.PREFIXES.BASE_API",
  });
});

test("language configuration keeps brackets out of comments and strings", () => {
  const brackets = languageConfiguration.brackets;
  const bracketPairs = languageConfiguration.autoClosingPairs.filter((pair) => ["{", "[", "(", "<"].includes(pair.open));
  const quotePair = languageConfiguration.autoClosingPairs.find((pair) => pair.open === "\"");
  const unbalancedScopes = new Set(require("../package.json").contributes.grammars[0].unbalancedBracketScopes || []);

  assert.deepStrictEqual(brackets, [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
    ["<", ">"],
  ]);
  assert.ok(bracketPairs.every((pair) => Array.isArray(pair.notIn) && pair.notIn.includes("comment") && pair.notIn.includes("string")));
  assert.ok(Array.isArray(quotePair?.notIn) && quotePair.notIn.includes("comment") && quotePair.notIn.includes("string"));
  assert.ok(unbalancedScopes.has("comment"));
  assert.ok(unbalancedScopes.has("comment.line"));
  assert.ok(unbalancedScopes.has("comment.line.number-sign"));
  assert.ok(unbalancedScopes.has("string"));
  assert.ok(unbalancedScopes.has("meta.path.segment.quoted"));
});

test("cli check uses the same analyzer diagnostics", () => {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "msra-cli-"));
  const filePath = path.join(tmpDir, "invalid.msra");
  writeFileSync(
    filePath,
    [
      "[app]",
      "[app.func.A3A417]",
      "[app.func.A3A417.input.query]",
      'values=["one"]',
      'revalue={from=1, to=27}',
      "",
    ].join("\n"),
    "utf8",
  );

  const cliPath = path.resolve(__dirname, "..", "..", "bin", "msra.js");
  const result = spawnSync(process.execPath, [cliPath, "check", filePath], {
    encoding: "utf8",
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;

  assert.notStrictEqual(result.status, 0);
  assert.match(output, /conflicting-assignment-keys/);
  assert.match(output, /values/);
  assert.match(output, /revalue/);
});
