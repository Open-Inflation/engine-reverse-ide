const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { mkdtempSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const test = require("node:test");

const { analyzeDocument } = require("../lsp/analysis");
const { parseDocument } = require("../lsp/parser");
const { loadProject } = require("../lsp/project-loader");
const { MsraLanguageServer } = require("../lsp/server");
const { collectSemanticTokens } = require("../lsp/semantic-tokens");
const languageConfiguration = require("../language-configuration.json");
const grammar = require("../syntaxes/msra.tmLanguage.json");

function hasTablePath(document, path) {
  for (const table of document.tables.values()) {
    if (table.path.length !== path.length) {
      continue;
    }
    if (table.path.every((segment, index) => segment === path[index])) {
      return true;
    }
  }
  return false;
}

function createMultiFileFixture({ invalidPrefix = false } = {}) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "msra-multifile-"));
  const parentPath = path.join(tmpDir, "parent.msra");
  const childPath = path.join(tmpDir, "funcs.msraf");
  const parentText = [
    "[app]",
    'name="RootAPI"',
    'package_name="root_api"',
    "[app.groups.Catalog]",
    'description="Catalog group"',
    "[app.func]",
    '!include("funcs.msraf")',
    "",
  ].join("\n");
  const childText = [
    '!root("./parent.msra")',
    "",
    invalidPrefix ? "[app.func.GET_USER]" : "[GET_USER]",
    'group=<GROUPS.Catalog>',
    "",
  ].join("\n");
  writeFileSync(parentPath, parentText, "utf8");
  writeFileSync(childPath, childText, "utf8");
  return {
    tmpDir,
    parentPath,
    childPath,
    parentText,
    childText,
  };
}

function createFuncResultFixture({
  sourceAnnotations = [],
  targetAnnotations = [],
  sourceExampleName = "source_snapshot",
  targetExampleName = "target_snapshot",
  reference = null,
} = {}) {
  const renderedReference = reference || `<FUNCRESULT.SRC.${sourceExampleName}.JSON[@Key(0)]["some"]["path"][0]>`;
  const renderAnnotations = (annotations) => annotations.map((annotation) => `@${annotation}`);
  return [
    "[app]",
    'package_name="test_api"',
    "",
    "[app.func.SRC]",
    "",
    "[app.func.SRC.input.query]",
    "type=string",
    "",
    "[app.func.SRC.examples]",
    `[app.func.SRC.examples.${sourceExampleName}]`,
    ...renderAnnotations(sourceAnnotations),
    'inputs={"query"="source"}',
    "",
    "[app.func.DST]",
    "",
    "[app.func.DST.input.query]",
    "type=string",
    "",
    "[app.func.DST.examples]",
    `[app.func.DST.examples.${targetExampleName}]`,
    ...renderAnnotations(targetAnnotations),
    `inputs={"query"=${renderedReference}}`,
    "",
  ].join("\n");
}

test("example document stays valid and keeps the documented path", () => {
  const examplePath = path.resolve(__dirname, "..", "..", "examples", "example", "example.msra");
  const text = readFileSync(examplePath, "utf8");
  const document = parseDocument(text, examplePath);
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
  assert.ok(
    hasTablePath(document, ["app", "func", "A3A417", "url", "params", "from_global", "params", "text"]),
    "expected the nested url params table from the example file to be indexed",
  );
  assert.ok(
    hasTablePath(document, ["app", "func", "A3A417", "examples", "smoke"]),
    "expected the named example table from the example file to be indexed",
  );
});

test("fixprice document stays valid", () => {
  const fixpricePath = path.resolve(__dirname, "..", "..", "examples", "fixprice", "fixprice.msra");
  const text = readFileSync(fixpricePath, "utf8");
  const document = parseDocument(text, fixpricePath);
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
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

test("quoted and unquoted table headers resolve to the same path", () => {
  const text = [
    "[app.func.A3A417]",
    '[app.func."A3A417"]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///quoted-vs-unquoted-path.msra");
  const duplicateTableDiagnostic = document.diagnostics.find((diagnostic) => diagnostic.code === "duplicate-table");

  assert.ok(duplicateTableDiagnostic, "expected quoted and unquoted headers to map to the same path");
  assert.ok(
    hasTablePath(document, ["app", "func", "A3A417"]),
    "expected the table path to be indexed once regardless of quoting",
  );
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
    'package_owner="Miskler"',
    'social={telegram="https://t.me/miskler_dev", discord="https://discord.gg/UnJnGHNbBp"}',
    'authors=[{name="Miskler", email="miskler@gmail.com"}, {name="Another Author", email="author@example.com"}]',
    'logo="./logo.png"',
    'description="Ozon API integration for catalog browsing and cart flows"',
    'license="GPL-3.0-or-later"',
    'keywords=["ozon", "api", "browser", "catalog"]',
    'min_required_python="3.10"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///app-metadata.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("app metadata rejects malformed authors and license values", () => {
  const text = [
    "[app]",
    'package_owner="bad owner!"',
    'social={telegram="not-a-url"}',
    'authors=[{name="Miskler"}]',
    'logo="./logo.txt"',
    'license="GNU General Public License"',
    'min_required_python="3.x"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-app-metadata.msra");
  const analysis = analyzeDocument(document);
  const invalidPackageOwner = analysis.diagnostics.find((item) => item.code === "invalid-assignment-value-type");
  const invalidSocial = analysis.diagnostics.filter((item) => item.code === "invalid-assignment-value-type").find((item) => /URL like/.test(item.message));
  const invalidLogo = analysis.diagnostics.filter((item) => item.code === "invalid-assignment-value-type").find((item) => /relative image path/.test(item.message));
  const missingEmail = analysis.diagnostics.find((item) => item.code === "missing-inline-table-key");
  const invalidValues = analysis.diagnostics.filter((item) => item.code === "invalid-assignment-value-type");
  const invalidLicense = invalidValues.find((item) => /license abbreviation/.test(item.message));
  const invalidPython = invalidValues.find((item) => /minimum required Python version/.test(item.message));

  assert.ok(invalidPackageOwner, "expected package_owner with spaces to be rejected");
  assert.match(invalidPackageOwner.message, /GitHub owner/);
  assert.ok(invalidSocial, "expected social URLs to require https links");
  assert.match(invalidSocial.message, /URL like/);
  assert.ok(invalidLogo, "expected logo paths to require a local image file");
  assert.match(invalidLogo.message, /relative image path/);
  assert.ok(missingEmail, "expected authors entries to require an email");
  assert.match(missingEmail.message, /email/);
  assert.ok(invalidLicense, "expected app.license to require a short license identifier");
  assert.match(invalidLicense.message, /license abbreviation/);
  assert.ok(invalidPython, "expected min_required_python to require a dotted version string");
  assert.match(invalidPython.message, /3\.10/);
});

test("app logo must use a local raster image path", () => {
  const text = [
    "[app]",
    'logo="./logo.txt"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-app-logo.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-assignment-value-type");

  assert.ok(diagnostic, "expected app.logo to require an image path");
  assert.match(diagnostic.message, /relative image path/);
});

test("version and name cannot be dynamic", () => {
  const text = [
    "[msra]",
    "version=<INPUT.version>",
    "[app]",
    "version=<INPUT.version>",
    "[app.func.A3A417]",
    "name=<INPUT.name>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///dynamic-version-name.msra");
  const analysis = analyzeDocument(document);
  const versionDiagnostics = analysis.diagnostics.filter((item) => item.code === "invalid-version-dynamic");
  const nameDiagnostic = analysis.diagnostics.find((item) => item.code === "invalid-function-name-dynamic");

  assert.strictEqual(versionDiagnostics.length, 2, "expected both version fields to reject dynamic references");
  assert.ok(nameDiagnostic, "expected function name to reject dynamic references");
});

test("description fields cannot be dynamic", () => {
  const text = [
    "[app]",
    "[app.variables.city_id]",
    "description=<INPUT.description>",
    "[app.regexes.TEXT_REQUEST]",
    'regex="^[a-z]+$"',
    "actions=[{action=lower}]",
    "raise=<INPUT.raise>",
    "description=<INPUT.description>",
    "[app.groups.Catalog]",
    "description=<INPUT.description>",
    "[app.func.A3A417]",
    "description=<INPUT.description>",
    "[app.func.A3A417.input.query]",
    'type=string',
    "description=<INPUT.description>",
    "[app.func.A3A417.examples]",
    "[app.func.A3A417.examples.smoke]",
    "description=<INPUT.description>",
    "[app.func.A3A417.url.params.url]",
    "description=<INPUT.description>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///dynamic-descriptions.msra");
  const analysis = analyzeDocument(document);
  const diagnostics = analysis.diagnostics.filter((item) => item.code === "invalid-description-dynamic");
  const regexRaiseDiagnostic = analysis.diagnostics.find((item) => item.code === "invalid-regex-raise-dynamic");

  assert.strictEqual(diagnostics.length, 7, "expected all dynamic descriptions to be rejected");
  assert.ok(regexRaiseDiagnostic, "expected regex raise to reject dynamic references");
});

test("regex action fields cannot be dynamic", () => {
  const text = [
    "[app]",
    "[app.regexes.TEXT_REQUEST]",
    'regex="^[a-z]+$"',
    'actions=[{action=replace, what=<INPUT.what>, with=<INPUT.with>}]',
    "raise=<INPUT.raise>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///dynamic-pipeline-and-actions.msra");
  const analysis = analyzeDocument(document);
  const actionWhatDiagnostic = analysis.diagnostics.find((item) => item.code === "invalid-regex-action-what-dynamic");
  const actionWithDiagnostic = analysis.diagnostics.find((item) => item.code === "invalid-regex-action-with-dynamic");
  const regexRaiseDiagnostic = analysis.diagnostics.find((item) => item.code === "invalid-regex-raise-dynamic");

  assert.ok(actionWhatDiagnostic, "expected regex action what to reject dynamic references");
  assert.ok(actionWithDiagnostic, "expected regex action with to reject dynamic references");
  assert.ok(regexRaiseDiagnostic, "expected regex raise to reject dynamic references");
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

  assert.strictEqual(diagnostics.length, 4);
  assert.match(diagnostics[0].message, /jpg|jpeg|png/i);
  assert.match(diagnostics[1].message, /GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS/);
  assert.match(diagnostics[2].message, /cors|no-cors|same-origin/);
  assert.match(diagnostics[3].message, /omit|same-origin|include/);
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

test("render_html is only valid inside extractor", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    'transport=fetch',
    'render_html=true',
    "",
    "[app.func.A3A417.extractor]",
    "@RenderHtml",
    'script="extractors/catalog-product-info.js"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///render-html-placement.msra");
  const analysis = analyzeDocument(document);

  const rootDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unknown-assignment-key");
  assert.ok(rootDiagnostic, "expected render_html on the root function table to be rejected");
  assert.match(rootDiagnostic.message, /render_html/);
});

test("goto_pipeline must be a Python script reference", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    'transport=goto',
    "[app.func.A3A417.extractor]",
    "@RenderHtml",
    'script="extractors/catalog-product-info.js"',
    'goto_pipeline=[{action=wait_network, state=networkidle}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///function-extractor-context.msra");
  const analysis = analyzeDocument(document);

  const gotoPipelineDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-assignment-value-type");

  assert.ok(gotoPipelineDiagnostic, "expected inline goto_pipeline DSL to be rejected");
  assert.match(gotoPipelineDiagnostic.message, /Python script reference/);
});

test("function extractor requires a script", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    'transport=goto',
    "[app.func.A3A417.extractor]",
    "@RenderHtml",
    'goto_pipeline="./goto_pipeline.py:pipeline"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///function-extractor-script.msra");
  const analysis = analyzeDocument(document);

  const extractorDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-function-extractor-script");

  assert.ok(extractorDiagnostic, "expected extractor to require a script");
  assert.match(extractorDiagnostic.message, /extractor/);
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

test("nested example tables, values, list_style, and types structures are validated strictly", () => {
  const text = [
    "[app]",
    "[app.variables.city_id]",
    'types=[{"match"={from=1, to=27}}]',
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
    "[app.func.A3A417.examples.smoke]",
    "@Docs",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///strict-nested-structures.msra");
  const analysis = analyzeDocument(document);

  const missingType = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-inline-table-key" && /type/.test(diagnostic.message));
  const badDelimiter = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-assignment-value-type" && /delimiter|stringish|string/i.test(diagnostic.message));
  const unknownListStyleKey = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unknown-inline-table-key" && /extra/.test(diagnostic.message));
  const unknownValuesKey = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unknown-inline-table-key" && /foo/.test(diagnostic.message));

  assert.ok(missingType, "expected a missing type field inside app.variables.city_id.types");
  assert.ok(badDelimiter, "expected a non-string delimiter inside list_style to be rejected");
  assert.ok(unknownListStyleKey, "expected unexpected list_style keys to be rejected");
  assert.ok(unknownValuesKey, "expected unexpected values keys to be rejected");
});

test("example tables accept @Docs and @Test annotations", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    "type=string",
    "[app.func.A3A417.examples]",
    "[app.func.A3A417.examples.smoke]",
    "@Test",
    "@Docs",
    "type=json",
    'description="Smoke test"',
    'inputs={"query"="example"}',
    "[app.func.A3A417.examples.alt_query]",
    "@Docs",
    "type=text",
    'description="Alternative query"',
    'inputs={"query"="example2"}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///example-item-annotations.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("example tables accept explicit output types, including image", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.url]",
    "type=string",
    "@Required",
    "[app.func.A3A417.examples]",
    "[app.func.A3A417.examples.snapshot]",
    "@Docs",
    "type=image",
    'description="Image example"',
    'inputs={"url"="https://example.com/image.png"}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///example-item-types.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("readme pipeline variable name collisions are reported by LSP", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    "type=string",
    "[app.func.A3A417.examples]",
    "[app.func.A3A417.examples.snapshot]",
    "@Docs",
    'description="First example"',
    'inputs={"query"="example1"}',
    "",
    "[app.func.B3B418]",
    "[app.func.B3B418.input.query]",
    "type=string",
    "[app.func.B3B418.examples]",
    "[app.func.B3B418.examples.snapshot]",
    "@Docs",
    'description="Second example"',
    'inputs={"query"="example2"}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///readme-collision.msra");
  const analysis = analyzeDocument(document);
  const collisionDiagnostics = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "duplicate-readme-example-variable");

  assert.strictEqual(collisionDiagnostics.length, 2, "expected both colliding examples to be reported");
  assert.match(collisionDiagnostics[0].message, /snapshot/);
});

test("example tables allow omitted inputs as an empty default", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    "type=string",
    "[app.func.A3A417.examples]",
    "[app.func.A3A417.examples.smoke]",
    "@Docs",
    'description="Smoke test"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///empty-example-inputs.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("example tables reject legacy file and test keys", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    "type=string",
    "[app.func.A3A417.examples]",
    "[app.func.A3A417.examples.smoke]",
    'inputs={"query"="example"}',
    'file="local1.json"',
    "test=true",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///legacy-example-keys.msra");
  const analysis = analyzeDocument(document);
  const unknownKey = analysis.diagnostics.find((item) => item.code === "unknown-assignment-key");
  const annotationRequired = analysis.diagnostics.find((item) => item.code === "annotation-required");

  assert.ok(unknownKey, "expected file to be rejected in the new examples contract");
  assert.match(unknownKey.message, /file/);
  assert.ok(annotationRequired, "expected test=true to require the @Test annotation");
  assert.match(annotationRequired.message, /@Test/);
});

test("example tables reject undeclared function inputs", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.examples]",
    "[app.func.A3A417.examples.smoke]",
    "@Docs",
    'inputs={"query"="example"}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///missing-example-input.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "missing-example-input");

  assert.ok(diagnostic, "expected example inputs to reject undeclared function inputs");
  assert.match(diagnostic.message, /query/);
});

test("example tables inputs must match declared function input types", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    "type=string",
    "[app.func.A3A417.examples]",
    "[app.func.A3A417.examples.smoke]",
    "@Docs",
    'inputs={"query"=1}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-example-input-type.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-example-input-type");

  assert.ok(diagnostic, "expected example inputs to reject values that do not match the declared input type");
  assert.match(diagnostic.message, /query/);
  assert.match(diagnostic.message, /string/);
  assert.match(diagnostic.message, /integer/);
});

test("url param const conflicts with from, values, and match", () => {
  const text = [
    "[app]",
    'name="ConstAPI"',
    'version="0.1.0"',
    'description=""',
    "",
    "[app.regexes.TEXT_REQUEST]",
    'regex="^[a-z]+$"',
    "",
    "[app.groups.Testing]",
    'description="Testing"',
    "",
    "[app.func.A3A417]",
    'name="search"',
    "transport=fetch",
    "method=GET",
    "group=<GROUPS.Testing>",
    "",
    "[app.func.A3A417.input.search]",
    "type=string",
    "",
    "[app.func.A3A417.url]",
    'base="https://example.com/"',
    "",
    "[app.func.A3A417.url.params.searchType]",
    'const="metro"',
    "from=<INPUT.search>",
    'values=[{"value_in_url"="metro", "default"=true}]',
    "match=<DOCUMENT.REGEXES.TEXT_REQUEST>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///conflicting-const-param.msra");
  const analysis = analyzeDocument(document);
  const conflictDiagnostics = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "conflicting-inline-table-keys");

  assert.strictEqual(conflictDiagnostics.length, 3);
  assert.ok(conflictDiagnostics.some((item) => /const.*from|from.*const/.test(item.message)));
  assert.ok(conflictDiagnostics.some((item) => /const.*values|values.*const/.test(item.message)));
  assert.ok(conflictDiagnostics.some((item) => /const.*match|match.*const/.test(item.message)));
});

test("variable type items accept scalar match lists", () => {
  const text = [
    "[app]",
    "[app.variables.delivery_type]",
    'types=[{"type"=string, "match"=["store", "pickup", "courier"]}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///variable-match-list.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("variable type items reject legacy value keys", () => {
  const text = [
    "[app]",
    "[app.variables.city_id]",
    'types=[{"type"=integer, "value"=null, "match"={from=1, to=27}}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///conflicting-variable-type-value-match.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "unknown-inline-table-key");

  assert.ok(diagnostic, "expected legacy value keys to be rejected inside variable type items");
  assert.match(diagnostic.message, /value/);
});

test("@ReadOnly annotation on app.variables stays valid", () => {
  const text = [
    "[app]",
    "[app.variables.city_id]",
    'types=[{"type"=integer}]',
    "@ReadOnly",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-variable-read-only.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("@Nullable annotation on app.variables stays valid", () => {
  const text = [
    "[app]",
    "[app.variables.city_id]",
    "@Nullable",
    'types=[{"type"=integer}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///nullable-variable.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("@Required stays valid on inputs and @SubUrl stays valid on url.params", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    "type=string",
    "@Required",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    "@SubUrl",
    'values=[{"value_in_url"="/search", "value"="search"}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///valid-required-suburl-annotations.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("values and match cannot coexist in input and url params tables", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type=string',
    'values=["one", "two"]',
    'match={from=1, to=27}',
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    'values=[{"value_in_url"="/search", "value"="search"}]',
    'match={from=1, to=27}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///conflicting-values-match.msra");
  const analysis = analyzeDocument(document);
  const conflictDiagnostics = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "conflicting-assignment-keys");

  assert.strictEqual(conflictDiagnostics.length, 2);
  assert.match(conflictDiagnostics[0].message, /values/);
  assert.match(conflictDiagnostics[0].message, /match/);
  assert.match(conflictDiagnostics[1].message, /values/);
  assert.match(conflictDiagnostics[1].message, /match/);
});

test("string match syntax is rejected in favor of reference or numeric range form", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type=string',
    'match="^[a-z]+$"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///string-match-is-invalid.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-assignment-value-type");

  assert.ok(diagnostic, "expected string match syntax to be rejected");
  assert.match(diagnostic.message, /reference <\.\.\.>|numeric range/i);
});

test("reference match syntax is accepted", () => {
  const text = [
    "[app]",
    "[app.regexes.TEXT_REQUEST]",
    'regex="^[a-z]+$"',
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type=string',
    'match=<DOCUMENT.REGEXES.TEXT_REQUEST>',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///reference-match-is-valid.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("legacy DOCUMENT.REGEX alias is no longer resolved", () => {
  const text = [
    "[app]",
    "[app.regexes.TEXT_REQUEST]",
    'regex="^[a-z]+$"',
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type=string',
    'match=<DOCUMENT.REGEX.TEXT_REQUEST>',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///legacy-document-regex-alias.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "unresolved-reference");

  assert.ok(diagnostic, "expected the legacy DOCUMENT.REGEX alias to be rejected");
  assert.match(diagnostic.message, /DOCUMENT\.REGEX\.TEXT_REQUEST/);
});

test("inline regex object match syntax is rejected in favor of reference or numeric range form", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type=string',
    'match={regex="^[a-z]+$"}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///inline-regex-match-is-invalid.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-assignment-value-type");

  assert.ok(diagnostic, "expected inline regex object syntax to be rejected");
  assert.match(diagnostic.message, /reference <\.\.\.>|numeric range/i);
});

test("goto_pipeline script references are accepted in extractor tables", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "transport=goto",
    "[app.func.A3A417.extractor]",
    "@RenderHtml",
    'script="extractors/catalog-product-info.js"',
    'goto_pipeline="./goto_pipeline.py:pipeline"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///valid-extractor-goto-pipeline.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("goto_pipeline script references are rejected when transport is fetch", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    'transport=fetch',
    "[app.func.A3A417.extractor]",
    "@RenderHtml",
    'script="extractors/catalog-product-info.js"',
    'goto_pipeline="./goto_pipeline.py:pipeline"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-extractor-goto-pipeline-transport.msra");
  const analysis = analyzeDocument(document);
  const invalidStateDiagnostics = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "unexpected-function-extractor");

  assert.strictEqual(invalidStateDiagnostics.length, 1, "expected extractor tables to be rejected for non-goto transports");
  assert.ok(/extractor/.test(invalidStateDiagnostics[0].message));
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

test("url param values reject dynamic value references", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    'values=[{"value_in_url"="/searchSuggestions/search/", "value"=<INPUT.url>, "default"=true}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///dynamic-url-param-value.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-url-param-value-dynamic");

  assert.ok(diagnostic, "expected URL param value references to be rejected");
  assert.match(diagnostic.message, /dynamic/);
  assert.match(diagnostic.message, /reference/i);
});

test("list url params with from require at least one selectable value", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.url]",
    "type=list[string]",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    "@List",
    "from=<INPUT.url>",
    'values=[{"value_in_url"="/searchSuggestions/search/", "default"=true}, {"value_in_url"="/searchSuggestions/search/", "default"=true}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///missing-selectable-url-param-value.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "missing-url-param-selectable-value");

  assert.ok(diagnostic, "expected list url params with from to require at least one selectable value");
  assert.match(diagnostic.message, /default=true/);
  assert.match(diagnostic.message, /match/);
});

test("list url params with match can omit selectable values", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.url]",
    "type=list[string]",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    "@List",
    "from=<INPUT.url>",
    "match={from=1, to=27}",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///url-param-match-allows-missing-values.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "missing-url-param-selectable-value");

  assert.ok(!diagnostic, "expected match to make selectable values optional");
});

test("list url params reject non-list inputs in from", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    'type=string',
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    "@List",
    "from=<INPUT.query>",
    'values=[{"value_in_url"="/search", "value"="search"}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-list-url-param-input.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-url-param-list-input-type");

  assert.ok(diagnostic, "expected list url params to reject non-list inputs in from");
  assert.match(diagnostic.message, /@List/);
  assert.match(diagnostic.message, /INPUT\.query/);
});

test("list url params accept list-typed inputs in from", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    "type=list[string]",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    "@List",
    "from=<INPUT.query>",
    'values=[{"value_in_url"="/search", "value"="search"}]',
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

test("numeric match ranges accept integer, float, and one-sided bounds", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.limit]",
    'type=integer',
    'match={from=1, to=27}',
    "[app.func.A3A417.input.lower_limit]",
    'type=integer',
    'match={from=1}',
    "[app.func.A3A417.input.upper_limit]",
    'type=integer',
    'match={to=27}',
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.ratio]",
    'match={from=0.5, to=2.5}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///numeric-match-ranges.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("numeric match ranges require ordered bounds", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.limit]",
    'type=integer',
    'match={from=27, to=1}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-numeric-match-range.msra");
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

test("@Humanize and @BlockImages require camoufox browser", () => {
  const text = [
    "[app]",
    'browser=chromium',
    "@Humanize",
    "@BlockImages",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-warmup-context.msra");
  const analysis = analyzeDocument(document);
  const diagnostics = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-warmup-context");

  assert.strictEqual(diagnostics.length, 2);
  assert.match(diagnostics[0].message, /camoufox/);
});

test("@Humanize accepts positive numbers when camoufox is enabled", () => {
  const text = [
    "[app]",
    'browser=camoufox',
    "@Humanize(0.5)",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///valid-humanize-number.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("warmup accepts an external script reference", () => {
  const text = [
    "[app]",
    "[app.warmup]",
    'warmup="./warmup.py:pipeline"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///warmup-script-reference.msra");
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

test("warmup rejects removed humanize_action key", () => {
  const text = [
    "[app]",
    'browser=camoufox',
    "[app.warmup]",
    'humanize_action={from=1000, to=3000}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///removed-humanize-action.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "unknown-assignment-key");

  assert.ok(diagnostic, "expected humanize_action to be rejected as an unsupported warmup key");
  assert.match(diagnostic.message, /humanize_action/);
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
    'from={"key"="value"}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///unexpected-boundary.msra");
  const analysis = analyzeDocument(document);
  const boundaryDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unexpected-body-boundary");

  assert.ok(boundaryDiagnostic, "expected a boundary outside multipart/form-data to be rejected");
  assert.match(boundaryDiagnostic.message, /multipart\/form-data/);
});

test("urlencoded bodies require from or a nested url table", () => {
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

  assert.ok(payloadDiagnostic, "expected x-www-form-urlencoded bodies to require from or a url table");
  assert.match(payloadDiagnostic.message, /from/);
  assert.match(payloadDiagnostic.message, /url/);
});

test("urlencoded body items accept a nested url table under the body item itself", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.body]",
    '[app.func.A3A417.body.VLOJENNOST.ANYNAME3]',
    'type="application/x-www-form-urlencoded"',
    '[app.func.A3A417.body.VLOJENNOST.ANYNAME3.url]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///nested-urlencoded-url.msra");
  const analysis = analyzeDocument(document);
  const payloadDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "missing-body-payload");

  assert.ok(!payloadDiagnostic, "expected the nested url table to satisfy the urlencoded body requirement");
});

test("default function headers accept referrer cors_mode credentials and headers", () => {
  const text = [
    "[app]",
    "[app.prefixes]",
    'ORIGIN="https://www.ozon.ru/"',
    "[app.defaults.func.headers]",
    'referrer=<DOCUMENT.PREFIXES.ORIGIN>',
    'cors_mode=cors',
    'credentials=include',
    "headers=<UNSTANDARD_HEADERS>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///shared-headers.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("legacy shared function headers block is rejected", () => {
  const text = [
    "[app]",
    "[app.prefixes]",
    'ORIGIN="https://www.ozon.ru/"',
    "[app.func.headers]",
    'referrer=<DOCUMENT.PREFIXES.ORIGIN>',
    'cors_mode=cors',
    'credentials=include',
    "headers=<UNSTANDARD_HEADERS>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///legacy-shared-headers.msra");
  const analysis = analyzeDocument(document);
  const unknownKeyDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unknown-assignment-key");

  assert.ok(unknownKeyDiagnostic, "expected the legacy shared headers block to be rejected");
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

test("url param values cannot define multiple defaults unless @List is present", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    'values=[{"value_in_url"="/search", "default"=true}, {"value_in_url"="/search-alt", "default"=true}]',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///duplicate-url-param-default.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "duplicate-url-param-default");

  assert.ok(diagnostic, "expected duplicate defaults to be rejected when @List is absent");
  assert.match(diagnostic.message, /@List/);
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
    "@Nullable",
    'types=[{"type"=integer, "match"={from=1, to=27}}]',
    'description="Идентификатор города"',
    'from=<UNSTANDARD_HEADERS.REQUEST.x-city>',
    "",
    "[app.func.A3A417]",
    "[app.func.A3A417.body]",
    "[app.func.A3A417.body.ANYNAME]",
    'type="application/json"',
    "from=<VARIABLES.ity_id>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///unresolved-variable.msra");
  const analysis = analyzeDocument(document);
  const unresolvedDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "unresolved-reference");

  assert.ok(unresolvedDiagnostic, "expected the typo in VARIABLES reference to be reported");
  assert.match(unresolvedDiagnostic.message, /VARIABLES\.ity_id/);
});

test("FUNCRESULT references are allowed inside example inputs", () => {
  const text = createFuncResultFixture({
    sourceAnnotations: ["Docs", "Test"],
    targetAnnotations: ["Docs", "Test"],
  });
  const document = parseDocument(text, "file:///funcresult-example-inputs.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("FUNCRESULT references skip docs and test checks when the referring example omits them", () => {
  const text = createFuncResultFixture();
  const document = parseDocument(text, "file:///funcresult-example-inputs-no-flags.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("FUNCRESULT references require matching @Docs and @Test flags on the referenced example", () => {
  const text = createFuncResultFixture({
    sourceAnnotations: [],
    targetAnnotations: ["Docs", "Test"],
  });
  const document = parseDocument(text, "file:///funcresult-example-inputs-missing-flags.msra");
  const analysis = analyzeDocument(document);
  const docsDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-funcresult-example-docs");
  const testDiagnostic = analysis.diagnostics.find((diagnostic) => diagnostic.code === "invalid-funcresult-example-test");

  assert.strictEqual(analysis.diagnostics.length, 2, "expected one docs and one test diagnostic");
  assert.ok(docsDiagnostic, "expected the referenced example to require @Docs");
  assert.ok(testDiagnostic, "expected the referenced example to require @Test");
  assert.match(docsDiagnostic.message, /@Docs/);
  assert.match(testDiagnostic.message, /@Test/);
});

test("FUNCRESULT references are allowed inside @Docs(print=...)", () => {
  const text = createFuncResultFixture({
    sourceAnnotations: ["Docs", "Test"],
    targetAnnotations: ['Docs(print="Первая категория: "<FUNCRESULT.SRC.source_snapshot.JSON[@Key(0)]["alias"]>)', "Test"],
  });
  const document = parseDocument(text, "file:///funcresult-docs-print.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("annotation-only flags reject explicit arguments", () => {
  const text = [
    "[app]",
    "browser=camoufox",
    "@Humanize(true)",
    "@BlockImages(false)",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    "type=string",
    "@Required(false)",
    "[app.variables.city_id]",
    "@ReadOnly(true)",
    "@Nullable(true)",
    'types=[{"type"=integer}]',
    "[app.func.A3A417.examples]",
    "[app.func.A3A417.examples.smoke]",
    "@Test(false)",
    "@Docs(foo=false)",
    'inputs={"query"="example"}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///invalid-annotation-arguments.msra");
  const analysis = analyzeDocument(document);
  const diagnostics = analysis.diagnostics.filter((item) => item.code === "invalid-annotation-argument");

  assert.strictEqual(diagnostics.length, 7);
  assert.ok(diagnostics.every((diagnostic) => /@Humanize|@BlockImages|@Required|@ReadOnly|@Nullable|@Test|@Docs/.test(diagnostic.message)));
});

test("legacy boolean toggles are rejected in favor of annotations", () => {
  const text = [
    "[app]",
    "browser=camoufox",
    "humanize=true",
    "block_images=true",
    "[app.warmup]",
    "headers_sniffer=true",
    "[app.variables.city_id]",
    "read_only=true",
    "nullable=true",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    "type=string",
    "required=true",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    "sub_url=true",
    "required=true",
    "list=true",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///legacy-annotation-syntax.msra");
  const analysis = analyzeDocument(document);
  const annotationRequiredDiagnostics = analysis.diagnostics.filter((item) => item.code === "annotation-required");
  const unknownAssignmentDiagnostics = analysis.diagnostics.filter((item) => item.code === "unknown-assignment-key");

  assert.strictEqual(annotationRequiredDiagnostics.length, 8);
  assert.ok(annotationRequiredDiagnostics.every((diagnostic) => /@Humanize|@BlockImages|@SniffHeaders|@ReadOnly|@Nullable|@Required|@SubUrl|@List/.test(diagnostic.message)));
  assert.strictEqual(unknownAssignmentDiagnostics.length, 1);
  assert.match(unknownAssignmentDiagnostics[0].message, /required/);
});

test("FUNCRESULT references reject the old function.kind.example order", () => {
  const text = createFuncResultFixture({
    reference: "<FUNCRESULT.SRC.JSON.source_snapshot>",
  });
  const document = parseDocument(text, "file:///funcresult-invalid-syntax.msra");
  const analysis = analyzeDocument(document);
  const diagnostics = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "invalid-funcresult-reference");
  const sourceExampleDiagnostic = diagnostics.find((diagnostic) => /result kind/i.test(diagnostic.message));

  assert.strictEqual(diagnostics.length, 2, "expected the old FUNCRESULT segment order to be rejected twice");
  assert.ok(sourceExampleDiagnostic, "expected the parser and validator to report the invalid segment order");
  assert.match(sourceExampleDiagnostic.message, /result kind JSON, TEXT, or IMAGE/i);
});

test("variable sources cannot reference themselves", () => {
  const text = [
    "[app]",
    "[app.variables.city_id]",
    'types=[{"type"=integer}]',
    'description="City id"',
    "from=<VARIABLES.city_id>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///self-referential-variable.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "self-referential-variable-source");

  assert.ok(diagnostic, "expected a variable to reject referencing itself");
  assert.match(diagnostic.message, /city_id/);
});

test("variable sources reject circular dependencies", () => {
  const text = [
    "[app]",
    "[app.variables.a]",
    'types=[{"type"=string}]',
    'description="A"',
    "from=<VARIABLES.b>",
    "[app.variables.b]",
    'types=[{"type"=string}]',
    'description="B"',
    "from=<VARIABLES.a>",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///circular-variable-sources.msra");
  const analysis = analyzeDocument(document);
  const diagnostics = analysis.diagnostics.filter((item) => item.code === "circular-variable-source");

  assert.strictEqual(diagnostics.length, 2, "expected both variables in the cycle to be rejected");
  assert.match(diagnostics[0].message, /app\.variables\.a/);
  assert.match(diagnostics[0].message, /app\.variables\.b/);
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
  assert.match(headerPattern.begin, /msra\\b/);
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
  assert.match(grammar.repository["path-system-segment"].patterns[0].match, /defaults/);
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

test("grammar highlights annotations separately from assignment keys", () => {
  const annotationPatterns = grammar.repository.annotations.patterns;

  assert.strictEqual(annotationPatterns.length, 1);
  assert.strictEqual(annotationPatterns[0].name, "meta.annotation.msra");
  assert.match(annotationPatterns[0].match, /@/);
  assert.strictEqual(annotationPatterns[0].captures[1].name, "punctuation.whitespace.leading.msra");
  assert.strictEqual(annotationPatterns[0].captures[2].name, "keyword.other.annotation.msra");
  assert.notStrictEqual(annotationPatterns[0].captures[2].name, grammar.repository.assignments.patterns[0].name);
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
  assert.strictEqual(semanticRules["decorator.msra"].foreground, "#E06C75");
  assert.strictEqual(scopeToColor.get("keyword.other.attribute-name.msra"), "#E5C07B");
  assert.strictEqual(scopeToColor.get("keyword.other.annotation.msra"), "#E06C75");
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
    'from={"key": <VARIABLES.city_id>, "key2": "value", "key3": <INPUT.query>}',
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
  for (const needle of ["type", "return_name", "from"]) {
    assert.ok(findToken(needle, "property"), `expected ${needle} to be classified as an assignment key`);
  }
  for (const needle of ["key", "key2", "key3"]) {
    assert.ok(findToken(needle, "enumMember"), `expected ${needle} to be classified as an inline-table key`);
  }
  assert.ok(findToken("app", "namespace"), "expected app to be classified as a system segment");
  assert.ok(findToken("body", "namespace"), "expected body to be classified as a system segment");
  assert.ok(tokens.every((token) => token.tokenModifiers.includes("msra")), "expected all semantic tokens to carry the msra modifier");
});

test("semantic tokens classify reserved names by slot rather than literal text", () => {
  const text = [
    "[app.func.url]",
    "[app.func.A3A417.url]",
    "[app.func.A3A417.url.params.url]",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///slot-sensitive-paths.msra");
  const tokens = collectSemanticTokens(document);

  const findTokenOnLine = (line, needle, tokenType) => tokens.find((token) => {
    if (token.line !== line || token.tokenType !== tokenType) {
      return false;
    }
    const start = document.offsetAt({ line: token.line, character: token.character });
    const end = start + token.length;
    return text.slice(start, end) === needle;
  });

  assert.ok(findTokenOnLine(0, "url", "parameter"), "expected the function id slot to treat url as a custom name");
  assert.ok(findTokenOnLine(1, "url", "namespace"), "expected the child table slot to treat url as a system keyword");
  assert.ok(findTokenOnLine(2, "params", "namespace"), "expected params to stay system inside the url namespace");
  assert.ok(findTokenOnLine(2, "url", "parameter"), "expected the parameter-name slot to treat url as a custom name");
});

test("semantic tokens classify shared function defaults as reserved namespaces", () => {
  const text = [
    "[app.defaults.func.headers]",
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///defaults-headers-semantic.msra");
  const tokens = collectSemanticTokens(document);

  const findTokenOnLine = (line, needle, tokenType) => tokens.find((token) => {
    if (token.line !== line || token.tokenType !== tokenType) {
      return false;
    }
    const start = document.offsetAt({ line: token.line, character: token.character });
    const end = start + token.length;
    return text.slice(start, end) === needle;
  });

  assert.ok(findTokenOnLine(0, "defaults", "namespace"), "expected defaults to be classified as a system namespace");
  assert.ok(findTokenOnLine(0, "func", "namespace"), "expected func under defaults to be classified as a system namespace");
  assert.ok(findTokenOnLine(0, "headers", "namespace"), "expected headers under defaults.func to be classified as a system namespace");
});

test("semantic tokens keep prefix definitions custom without parent-dependent reference coloring", () => {
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

  assert.strictEqual(findTokens("BASE_API", "variable").length, 1, "expected the prefix assignment key to stay custom");
  assert.ok(findToken("BASE_API", "parameter"), "expected the prefix reference to behave like a normal path segment");
  assert.strictEqual(findTokens("ORIGIN", "variable").length, 1, "expected ORIGIN to be classified as a custom prefix variable");
  assert.ok(findToken("timeout_ms", "property"), "expected timeout_ms to remain a fixed assignment key");
});

test("semantic tokens classify annotations as decorators", () => {
  const text = [
    "[app]",
    "[app.func.A3A417]",
    "[app.func.A3A417.input.query]",
    "@Required",
    "type=string",
    "",
    "[app.func.A3A417.url.params.url]",
    "@SubUrl",
    'from="x"',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///annotation-semantic-tokens.msra");
  const tokens = collectSemanticTokens(document);

  const findToken = (needle, tokenType) => tokens.find((token) => {
    if (token.tokenType !== tokenType) {
      return false;
    }
    const start = document.offsetAt({ line: token.line, character: token.character });
    const end = start + token.length;
    return text.slice(start, end) === needle;
  });

  assert.ok(findToken("@Required", "decorator"), "expected @Required to be classified as a decorator");
  assert.ok(findToken("@SubUrl", "decorator"), "expected @SubUrl to be classified as a decorator");
  assert.strictEqual(tokens.filter((token) => token.tokenType === "decorator").length, 2);
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
    newText: "DOCUMENT.PREFIXES$0>",
  });
  assert.strictEqual(prefixItem.insertTextFormat, 2);

  const dottedItem = getCompletionItem("url=<DOCUMENT.PREFIXES.", "DOCUMENT.PREFIXES.BASE_API");
  assert.deepStrictEqual(dottedItem.textEdit, {
    range: {
      start: { line: 2, character: 5 },
      end: { line: 2, character: "url=<DOCUMENT.PREFIXES.".length },
    },
    newText: "DOCUMENT.PREFIXES.BASE_API$0>",
  });
  assert.strictEqual(dottedItem.insertTextFormat, 2);
});

test("reference completions insert angle brackets when the user has not typed them", () => {
  const getResponseCompletion = (lineText, character) => {
    const server = new MsraLanguageServer({
      onRequest() {},
      onNotification() {},
      listen() {},
      sendNotification() {},
    });
    const text = [
    "[app]",
    "[app.variables.city_id]",
    "@Nullable",
    'types=[{"type"=integer, "match"={from=1, to=2147483647}}]',
    'description="Current city id used by catalog and balance requests."',
    lineText,
    "",
  ].join("\n");
    const uri = `file:///completion-reference-wrap-${lineText.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.msra`;
    server._updateDocument({ textDocument: { uri, text } }, false);
    const response = server._completion({
      textDocument: { uri },
      position: {
        line: 5,
        character,
      },
    });
    const item = response.items.find((candidate) => candidate.label === "UNSTANDARD_HEADERS.RESPONSE");
    assert.ok(item, "expected response headers completion to be available");
    return item;
  };

  const bareItem = getResponseCompletion("from=", "from=".length);
  assert.deepStrictEqual(bareItem.textEdit, {
    range: {
      start: { line: 5, character: "from=".length },
      end: { line: 5, character: "from=".length },
    },
    newText: "<UNSTANDARD_HEADERS.RESPONSE.$0>",
  });
  assert.strictEqual(bareItem.insertTextFormat, 2);

  const closedItem = getResponseCompletion("from=<>", "from=<>".length);
  assert.deepStrictEqual(closedItem.textEdit, {
    range: {
      start: { line: 5, character: "from=<".length },
      end: { line: 5, character: "from=<>".length },
    },
    newText: "UNSTANDARD_HEADERS.RESPONSE.$0>",
  });
  assert.strictEqual(closedItem.insertTextFormat, 2);
});

test("FUNCRESULT completions are available inside example inputs", () => {
  const server = new MsraLanguageServer({
    onRequest() {},
    onNotification() {},
    listen() {},
    sendNotification() {},
  });
  const text = createFuncResultFixture().replace(
    '<FUNCRESULT.SRC.source_snapshot.JSON[@Key(0)]["some"]["path"][0]>',
    '<FUNCRESULT.SRC.',
  );
  const uri = "file:///completion-funcresult-example-inputs.msra";
  server._updateDocument({ textDocument: { uri, text } }, false);
  const lines = text.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.includes('FUNCRESULT.SRC.'));
  assert.ok(lineIndex >= 0, "expected to find the FUNCRESULT reference line");
  const startCharacter = lines[lineIndex].indexOf('<') + 1;
  const character = lines[lineIndex].indexOf('FUNCRESULT.SRC.') + 'FUNCRESULT.SRC.'.length;
  const response = server._completion({
    textDocument: { uri },
    position: {
      line: lineIndex,
      character,
    },
  });
  const jsonItem = response.items.find((candidate) => candidate.label === "FUNCRESULT.SRC.source_snapshot.JSON");
  const textItem = response.items.find((candidate) => candidate.label === "FUNCRESULT.SRC.source_snapshot.TEXT");
  const imageItem = response.items.find((candidate) => candidate.label === "FUNCRESULT.SRC.source_snapshot.IMAGE");

  assert.ok(jsonItem, "expected JSON FUNCRESULT completion to be available");
  assert.ok(textItem, "expected TEXT FUNCRESULT completion to be available");
  assert.ok(imageItem, "expected IMAGE FUNCRESULT completion to be available");
  assert.deepStrictEqual(jsonItem.textEdit, {
    range: {
      start: { line: lineIndex, character: startCharacter },
      end: { line: lineIndex, character },
    },
    newText: "FUNCRESULT.SRC.source_snapshot.JSON$0>",
  });
  assert.strictEqual(jsonItem.insertTextFormat, 2);
  assert.ok(!response.items.some((candidate) => candidate.label === "FUNCRESULT.SRC"), "expected bare function result labels to stay hidden");
});

test("FUNCRESULT supports @Key selectors inside JSON paths", () => {
  const text = [
    "[app]",
    'package_name="key_api"',
    "",
    "[app.func.SRC]",
    "",
    "[app.func.SRC.input.query]",
    "type=string",
    "",
    "[app.func.SRC.examples]",
    "[app.func.SRC.examples.source_snapshot]",
    "@Docs",
    'description="Source snapshot"',
    'inputs={"query"="source"}',
    "",
    "[app.func.DST]",
    "",
    "[app.func.DST.input.query]",
    "type=string",
    "",
    "[app.func.DST.examples]",
    "[app.func.DST.examples.destination_snapshot]",
    "@Docs",
    'description="Destination snapshot"',
    'inputs={"query"=<FUNCRESULT.SRC.source_snapshot.JSON[@Key(0)]["alias"]>}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///funcresult-key-selector.msra");
  const analysis = analyzeDocument(document);

  assert.deepStrictEqual(analysis.diagnostics, []);
});

test("FUNCRESULT rejects @Key selectors below -1", () => {
  const text = [
    "[app]",
    'package_name="key_api"',
    "",
    "[app.func.SRC]",
    "",
    "[app.func.SRC.input.query]",
    "type=string",
    "",
    "[app.func.SRC.examples]",
    "[app.func.SRC.examples.source_snapshot]",
    "@Docs",
    'description="Source snapshot"',
    'inputs={"query"="source"}',
    "",
    "[app.func.DST]",
    "",
    "[app.func.DST.input.query]",
    "type=string",
    "",
    "[app.func.DST.examples]",
    "[app.func.DST.examples.destination_snapshot]",
    "@Docs",
    'description="Destination snapshot"',
    'inputs={"query"=<FUNCRESULT.SRC.source_snapshot.JSON[@Key(-2)]>}',
    "",
  ].join("\n");
  const document = parseDocument(text, "file:///funcresult-key-selector-invalid.msra");
  const analysis = analyzeDocument(document);
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-funcresult-key-selector");

  assert.ok(diagnostic, "expected @Key values below -1 to be rejected");
  assert.match(diagnostic.message, /greater than or equal to -1/);
});

test("completion is field-aware for groups enums and static values", () => {
  const repoRoot = path.resolve(__dirname, "..", "..");
  const examplePath = path.join(repoRoot, "examples", "example", "example.msra");
  const server = new MsraLanguageServer({
    onRequest() {},
    onNotification() {},
    listen() {},
    sendNotification() {},
  });
  const text = readFileSync(examplePath, "utf8")
    .replace("group=<GROUPS.Catalog.Product>", "group=")
    .replace("transport=fetch", "transport=");
  const uri = "file:///completion-field-aware.msra";
  server._updateDocument({ textDocument: { uri, text } }, false);
  const lines = text.split(/\r?\n/);

  const getLabels = (needle) => {
    const lineIndex = lines.findIndex((line) => line.includes(needle));
    assert.ok(lineIndex >= 0, `expected to find ${needle}`);
    const position = {
      line: lineIndex,
      character: lines[lineIndex].indexOf(needle) + needle.length,
    };
    return server._completion({
      textDocument: { uri },
      position,
    }).items.map((item) => item.label);
  };

  const groupLabels = getLabels("group=");
  assert.ok(groupLabels.includes("GROUPS.Catalog.Product"), "expected group completions to suggest the configured group");
  assert.ok(!groupLabels.some((label) => label.startsWith("DOCUMENT.")), "expected group completions to avoid unrelated document references");

  const transportLabels = getLabels("transport=");
  assert.deepStrictEqual(new Set(transportLabels), new Set(["direct", "fetch", "goto"]));
});

test("completion narrows inline table values by field", () => {
  const server = new MsraLanguageServer({
    onRequest() {},
    onNotification() {},
    listen() {},
    sendNotification() {},
  });

  const cases = [
    {
      text: [
        "[app]",
        "[app.func.X]",
        "[app.func.X.url]",
        "[app.func.X.url.params.A]",
        'values=[{"value_in_url"="metro", "default"=}]',
        "",
      ].join("\n"),
      needle: '"default"=',
      expected: new Set(["true", "false"]),
    },
    {
      text: [
        "[app]",
        "[app.func.X]",
        "[app.func.X.input.city_id]",
        "type=integer",
        "match={from=1, to=}",
        "",
      ].join("\n"),
      needle: "to=",
      expected: new Set(),
    },
  ];

  for (const [index, testCase] of cases.entries()) {
    const uri = `file:///completion-nested-${index}.msra`;
    server._updateDocument({ textDocument: { uri, text: testCase.text } }, false);
    const lines = testCase.text.split(/\r?\n/);
    const lineIndex = lines.findIndex((line) => line.includes(testCase.needle));
    assert.ok(lineIndex >= 0, `expected to find ${testCase.needle}`);
    const response = server._completion({
      textDocument: { uri },
      position: {
        line: lineIndex,
        character: lines[lineIndex].indexOf(testCase.needle) + testCase.needle.length,
      },
    });
    const labels = new Set(response.items.map((item) => item.label));
    assert.deepStrictEqual(labels, testCase.expected);
  }
});

test("multi-file include/root projects resolve child msraf tables and parent references", () => {
  const fixture = createMultiFileFixture();
  const project = loadProject(fixture.parentPath);

  assert.strictEqual(project.rootPath, fixture.parentPath);
  assert.ok(project.documents.has(fixture.childPath), "expected the included child document to be loaded");
  assert.ok(
    hasTablePath(project.documents.get(fixture.childPath).transformed, ["app", "func", "GET_USER"]),
    "expected the child function table to be rewritten under app.func",
  );

  const childDocument = project.documents.get(fixture.childPath);
  const childAnalysis = analyzeDocument(childDocument.transformed, {
    tableIndex: project.mergedTables,
    assignmentIndex: project.mergedAssignments,
    rawDocument: childDocument.raw,
    sourcePath: fixture.childPath,
  });
  assert.deepStrictEqual(childAnalysis.diagnostics, []);

  const server = new MsraLanguageServer({
    onRequest() {},
    onNotification() {},
    listen() {},
    sendNotification() {},
  });
  const parentUri = pathToFileURL(fixture.parentPath).href;
  const childUri = pathToFileURL(fixture.childPath).href;
  server._updateDocument({ textDocument: { uri: parentUri, text: fixture.parentText } }, false);
  server._updateDocument({ textDocument: { uri: childUri, text: fixture.childText } }, false);

  const childState = server.documents.get(childUri);
  assert.ok(childState, "expected the child document to stay open in the server");
  assert.deepStrictEqual(childState.analyzed.diagnostics, []);

  const completionServer = new MsraLanguageServer({
    onRequest() {},
    onNotification() {},
    listen() {},
    sendNotification() {},
  });
  const completionText = fixture.childText.replace("group=<GROUPS.Catalog>", "group=");
  completionServer._updateDocument({ textDocument: { uri: parentUri, text: fixture.parentText } }, false);
  completionServer._updateDocument({ textDocument: { uri: childUri, text: completionText } }, false);

  const lines = completionText.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.includes("group="));
  const completion = completionServer._completion({
    textDocument: { uri: childUri },
    position: {
      line: lineIndex,
      character: lines[lineIndex].indexOf("group=") + "group=".length,
    },
  });
  assert.ok(
    completion.items.some((item) => item.label === "GROUPS.Catalog"),
    "expected child completions to see parent group tables through the merged project",
  );
});

test("multi-file msraf references navigate to parent definitions", () => {
  const fixture = createMultiFileFixture();
  const server = new MsraLanguageServer({
    onRequest() {},
    onNotification() {},
    listen() {},
    sendNotification() {},
  });
  const parentUri = pathToFileURL(fixture.parentPath).href;
  const childUri = pathToFileURL(fixture.childPath).href;
  server._updateDocument({ textDocument: { uri: parentUri, text: fixture.parentText } }, false);
  server._updateDocument({ textDocument: { uri: childUri, text: fixture.childText } }, false);

  const lines = fixture.childText.split(/\r?\n/);
  const lineIndex = lines.findIndex((line) => line.includes("<GROUPS.Catalog>"));
  assert.ok(lineIndex >= 0, "expected the child fixture to reference GROUPS.Catalog");

  const definition = server._definition({
    textDocument: { uri: childUri },
    position: {
      line: lineIndex,
      character: lines[lineIndex].indexOf("GROUPS.Catalog") + 1,
    },
  });

  assert.ok(Array.isArray(definition) && definition.length > 0, "expected a definition location");
  assert.strictEqual(definition[0].uri, parentUri);
  const parentLines = fixture.parentText.split(/\r?\n/);
  const parentLineIndex = parentLines.findIndex((line) => line === "[app.groups.Catalog]");
  assert.strictEqual(definition[0].range.start.line, parentLineIndex);
});

test("msraf files reject explicit app.func prefixes", () => {
  const fixture = createMultiFileFixture({ invalidPrefix: true });
  const project = loadProject(fixture.parentPath);
  const childDocument = project.documents.get(fixture.childPath);
  const analysis = analyzeDocument(childDocument.transformed, {
    tableIndex: project.mergedTables,
    assignmentIndex: project.mergedAssignments,
    rawDocument: childDocument.raw,
    sourcePath: fixture.childPath,
  });
  const diagnostic = analysis.diagnostics.find((item) => item.code === "invalid-msraf-table-path");

  assert.ok(diagnostic, "expected explicit app.func prefixes to be rejected in msraf files");
  assert.match(diagnostic.message, /omit the leading "app\.func" namespace/);
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
      'match={from=1, to=27}',
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
  assert.match(output, /match/);
});
