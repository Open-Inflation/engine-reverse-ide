const fs = require("fs");
const { fileURLToPath } = require("url");
const {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} = require("vscode-jsonrpc/node");
const {
  analyzeDocument,
  collectDefinitionLocations,
  renderRef,
} = require("./analysis");
const {
  DEFAULT_REFERENCE_ROOTS,
  EXAMPLE_INPUT_REFERENCE_ROOTS,
  isFuncResultReferenceContext,
} = require("./reference-context");
const { parseDocument } = require("./parser");
const { TABLE_SCHEMAS, validateValueSpec } = require("./assignment-schema");
const {
  ArrayExpr,
  InlineTableExpr,
  Position,
  Range,
  comparePaths,
  pathKey,
  pathLabel,
} = require("./model");

const LSP_SEVERITY = {
  error: 1,
  warning: 2,
  information: 3,
  hint: 4,
};

const REFERENCE_NAMESPACE_SPECS = {
  UNSTANDARD_HEADERS: {
    detail: "Runtime request/response headers",
    children: [
      { segment: "RESPONSE", detail: "Runtime response headers", continuable: true },
      { segment: "REQUEST", detail: "Runtime request headers", continuable: true },
    ],
  },
  CAPTURED_URLS: {
    detail: "Runtime captured URL list",
    children: [
      { segment: "RESPONSE", detail: "Runtime response URL list", continuable: true },
      { segment: "REQUEST", detail: "Runtime request URL list", continuable: true },
    ],
  },
};

function referenceNamespaceEntries(root, detail, children = []) {
  const entries = [];
  for (const child of children) {
    entries.push({
      label: `${root}.${child.segment}`,
      detail: child.detail,
      root,
      continuable: Boolean(child.continuable),
    });
  }
  entries.push({
    label: root,
    detail,
    root,
    continuable: false,
  });
  return entries;
}

function referenceContinuationSuffix(label) {
  const parts = String(label || "").split(".");
  if (parts.length < 2) {
    return "";
  }
  const spec = REFERENCE_NAMESPACE_SPECS[parts[0]];
  if (!spec) {
    return "";
  }
  const child = (spec.children || []).find((item) => item.segment === parts[1]);
  return child && child.continuable ? "." : "";
}

class OpenDocument {
  constructor(uri, text, parsed, analyzed) {
    this.uri = uri;
    this.text = text;
    this.parsed = parsed;
    this.analyzed = analyzed;
  }
}

class MsraLanguageServer {
  constructor(connection) {
    this.connection = connection;
    this.documents = new Map();
    this.rootUri = null;
    this.serverName = "msra-lsp";
    this.serverVersion = "0.1.0";
    this.shutdownRequested = false;
  }

  listen() {
    this.connection.onRequest("initialize", (params) => this._initialize(params || {}));
    this.connection.onRequest("shutdown", () => {
      this.shutdownRequested = true;
      return null;
    });
    this.connection.onNotification("initialized", () => {
      // No-op, kept for protocol completeness.
    });
    this.connection.onNotification("exit", () => {
      this.shutdownRequested = true;
    });
    this.connection.onNotification("textDocument/didOpen", (params) => this._updateDocument(params || {}, true));
    this.connection.onNotification("textDocument/didChange", (params) => this._updateDocument(params || {}, true));
    this.connection.onNotification("textDocument/didSave", (params) => this._updateDocument(params || {}, true));
    this.connection.onNotification("textDocument/didClose", (params) => this._closeDocument(params || {}));
    this.connection.onRequest("textDocument/completion", (params) => this._completion(params || {}));
    this.connection.onRequest("textDocument/hover", (params) => this._hover(params || {}));
    this.connection.onRequest("textDocument/definition", (params) => this._definition(params || {}));
    this.connection.onRequest("textDocument/documentSymbol", (params) => this._documentSymbol(params || {}));
    this.connection.onRequest("workspace/symbol", (params) => this._workspaceSymbol(params || {}));
    this.connection.listen();
  }

  _initialize(params) {
    this.rootUri = params.rootUri || null;
    return {
      capabilities: {
        textDocumentSync: 1,
        completionProvider: {
          resolveProvider: false,
          triggerCharacters: ["<", ".", "[", '"', "="],
        },
        hoverProvider: true,
        definitionProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
      },
      serverInfo: {
        name: this.serverName,
        version: this.serverVersion,
      },
    };
  }

  _updateDocument(params, publish = false) {
    const textDocument = params.textDocument || {};
    const uri = textDocument.uri;
    if (!uri) {
      return;
    }
    const text = this._extractText(uri, params);
    const parsed = parseDocument(text, uri);
    const analyzed = analyzeDocument(parsed);
    this.documents.set(uri, new OpenDocument(uri, text, parsed, analyzed));
    if (publish) {
      this._publishDiagnostics(uri, analyzed.diagnostics, parsed);
    }
  }

  _closeDocument(params) {
    const textDocument = params.textDocument || {};
    const uri = textDocument.uri;
    if (!uri) {
      return;
    }
    this.documents.delete(uri);
    this.connection.sendNotification("textDocument/publishDiagnostics", {
      uri,
      diagnostics: [],
    });
  }

  _extractText(uri, params) {
    const textDocument = params.textDocument || {};
    if (typeof textDocument.text === "string") {
      return textDocument.text;
    }
    const changes = params.contentChanges || [];
    if (changes.length) {
      const latest = changes[changes.length - 1];
      if (typeof latest.text === "string") {
        return latest.text;
      }
    }
    const filePath = this._uriToPath(uri);
    if (filePath && fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf8");
    }
    return "";
  }

  _publishDiagnostics(uri, diagnostics, document) {
    this.connection.sendNotification("textDocument/publishDiagnostics", {
      uri,
      diagnostics: diagnostics.map((diagnostic) => this._diagnosticToLsp(diagnostic, document)),
    });
  }

  _diagnosticToLsp(diagnostic) {
    return {
      range: this._rangeToLsp(diagnostic.range),
      severity: LSP_SEVERITY[diagnostic.severity] || 1,
      source: diagnostic.source,
      code: diagnostic.code,
      message: diagnostic.message,
    };
  }

  _completion(params) {
    const textDocument = params.textDocument || {};
    const uri = textDocument.uri;
    const document = this.documents.get(uri);
    if (document === undefined) {
      return { isIncomplete: false, items: [] };
    }
    const position = this._positionFromLsp(params.position || {});
    const completionContext = this._completionContext(document.parsed, position);
    const items = this._completionItems(document.analyzed, completionContext);
    return { isIncomplete: false, items };
  }

  _completionContext(document, position) {
    const offset = document.offsetAt(position);
    const text = document.text;
    let start = offset;
    while (start > 0 && !" \t\r\n=,+{}[]<>\"".includes(text[start - 1])) {
      start -= 1;
    }
    const lineStart = position.line < document.lineStarts.length ? document.lineStarts[position.line] : 0;
    const linePrefix = text.slice(lineStart, offset);
    const assignment = this._assignmentAt(document, position);
    const target = assignment ? this._completionTarget(assignment, position) : null;
    const openAngle = linePrefix.lastIndexOf("<");
    const closeAngle = linePrefix.lastIndexOf(">");
    const hasOpenReference = openAngle >= 0 && openAngle > closeAngle;
    const hasClosedReferencePlaceholder = openAngle >= 0 && closeAngle === openAngle + 1;
    if (hasOpenReference || hasClosedReferencePlaceholder) {
      const prefixStart = lineStart + openAngle + 1;
      const closeOffset = lineStart + closeAngle;
      const prefixEnd = hasClosedReferencePlaceholder && offset > closeOffset ? Math.max(prefixStart, offset - 1) : offset;
      return {
        prefix: text.slice(prefixStart, prefixEnd),
        context: "reference",
        range: this._rangeToLsp(document.rangeFromOffsets(prefixStart, offset)),
        assignment,
        target,
        suffix: hasClosedReferencePlaceholder && offset > closeOffset ? ">" : (text[offset] === ">" ? "" : ">"),
      };
    }
    const prefix = text.slice(start, offset);
    const range = this._rangeToLsp(document.rangeFromOffsets(start, offset));
    if (linePrefix.includes("[") && linePrefix.lastIndexOf("[") > linePrefix.lastIndexOf("]")) {
      return { prefix, context: "table", range, assignment, target, suffix: "" };
    }
    return { prefix, context: "value", range, assignment, target, suffix: "" };
  }

  _completionItems(analyzed, completionContext) {
    const fieldItems = this._fieldCompletionItems(analyzed, completionContext);
    const { prefix, context, range, insertPrefix = "", suffix = "" } = completionContext;
    const useSnippet = Boolean(completionContext.referenceCompletion) || context === "reference";
    const referenceRoots = completionContext.allowedReferenceRoots || DEFAULT_REFERENCE_ROOTS;
    if (fieldItems !== null) {
      return this._completionItemsFromPairs(fieldItems, prefix, range, context === "reference" ? 21 : 12, insertPrefix, suffix, useSnippet);
    }
    if (context === "reference") {
      return this._completionItemsFromPairs(this._referenceCompletions(analyzed, completionContext, referenceRoots), prefix, range, 21, "", suffix, true);
    }
    if (context === "table") {
      return this._completionItemsFromPairs(this._tableCompletions(analyzed), prefix, range, 21, "", suffix, false);
    }
    return this._completionItemsFromPairs(this._valueCompletions(), prefix, range, 12, "", suffix, false);
  }

  _fieldCompletionItems(analyzed, completionContext) {
    const target = completionContext.target || completionContext.assignment;
    if (!target) {
      return null;
    }
    const assignment = completionContext.assignment;
    const tablePath = assignment && assignment.tablePath ? assignment.tablePath : [];
    const schema = findSchemaForPath(tablePath);
    if (!schema) {
      return null;
    }
    const targetKey = target.key || (assignment && assignment.key) || null;
    const spec = target.spec || (targetKey && schema.allowUnknownKeys ? schema.valueSpec : targetKey ? schema.keys[targetKey] : null);
    if (!spec) {
      return null;
    }

    const literalSuggestions = this._literalSuggestionsForField(tablePath, targetKey, spec);
    if (literalSuggestions.length > 0) {
      return literalSuggestions;
    }

    const allowedRoots = this._allowedReferenceRoots(tablePath, target.valuePathSegments || [], targetKey, spec, schema);
    if (allowedRoots === null) {
      return [];
    }
    if (allowedRoots.length === 0) {
      return [];
    }
    completionContext.allowedReferenceRoots = allowedRoots;
    completionContext.insertPrefix = completionContext.context === "reference" ? "" : "<";
    completionContext.suffix = completionContext.context === "reference" ? completionContext.suffix : ">";
    completionContext.referenceCompletion = true;
    return this._referenceCompletions(analyzed, completionContext, allowedRoots);
  }

  _completionTarget(assignment, position) {
    const tablePath = assignment.tablePath || [];
    const schema = findSchemaForPath(tablePath);
    if (!schema) {
      return {
        assignment,
        tablePath,
        key: assignment.key,
        spec: null,
        value: assignment.value,
        valuePathSegments: [{
          value: assignment.key,
          quoted: Boolean(assignment.quoted),
          range: assignment.keyRange || null,
        }],
      };
    }
    const outerSpec = schema.allowUnknownKeys ? schema.valueSpec : schema.keys[assignment.key];
    if (!outerSpec) {
      return {
        assignment,
        tablePath,
        key: assignment.key,
        spec: null,
        value: assignment.value,
        valuePathSegments: [{
          value: assignment.key,
          quoted: Boolean(assignment.quoted),
          range: assignment.keyRange || null,
        }],
      };
    }
    const resolved = this._resolveCompletionTarget(
      assignment.value,
      outerSpec,
      position,
      assignment.key,
      [{
        value: assignment.key,
        quoted: Boolean(assignment.quoted),
        range: assignment.keyRange || null,
      }],
    );
    if (!resolved) {
      return {
        assignment,
        tablePath,
        key: assignment.key,
        spec: outerSpec,
        value: assignment.value,
        valuePathSegments: [{
          value: assignment.key,
          quoted: Boolean(assignment.quoted),
          range: assignment.keyRange || null,
        }],
      };
    }
    return {
      assignment,
      tablePath,
      key: resolved.key || assignment.key,
      spec: resolved.spec || outerSpec,
      value: resolved.value || assignment.value,
      valuePathSegments: resolved.valuePathSegments || [{
        value: assignment.key,
        quoted: Boolean(assignment.quoted),
        range: assignment.keyRange || null,
      }],
    };
  }

  _resolveCompletionTarget(value, spec, position, currentKey = null, valuePathSegments = []) {
    if (value instanceof ArrayExpr) {
      const item = this._arrayItemAt(value, position);
      const itemSpec = this._specForArrayValue(spec);
      if (!item) {
        return { key: currentKey, spec: itemSpec || spec, value, valuePathSegments };
      }
      return this._resolveCompletionTarget(item, itemSpec || spec, position, currentKey, valuePathSegments) || {
        key: currentKey,
        spec: itemSpec || spec,
        value: item,
        valuePathSegments,
      };
    }
    if (value instanceof InlineTableExpr) {
      const entry = this._inlineEntryAt(value, position);
      const entryKey = entry ? entry.key : currentKey;
      const tableSpec = this._specForInlineTableValue(spec, value, entryKey);
      if (!entry) {
        return { key: currentKey, spec: tableSpec || spec, value, valuePathSegments };
      }
      const entrySpec = this._specForInlineEntry(tableSpec || spec, value, entry.key, entryKey);
      const entryPathSegments = [
        ...valuePathSegments,
        {
          value: entry.key,
          quoted: Boolean(entry.quoted),
          range: entry.keyRange || null,
        },
      ];
      if (!entrySpec) {
        return { key: entry.key, spec: tableSpec || spec, value: entry.value, valuePathSegments: entryPathSegments };
      }
      return this._resolveCompletionTarget(entry.value, entrySpec, position, entry.key, entryPathSegments) || {
        key: entry.key,
        spec: entrySpec,
        value: entry.value,
        valuePathSegments: entryPathSegments,
      };
    }
    return { key: currentKey, spec, value, valuePathSegments };
  }

  _arrayItemAt(arrayExpr, position) {
    let fallback = null;
    for (const item of arrayExpr.items || []) {
      if (this._contains(item.range, position)) {
        return item;
      }
      if (item.range && item.range.start && item.range.start.line === position.line && item.range.start.character <= position.character) {
        if (fallback === null || item.range.start.character >= fallback.range.start.character) {
          fallback = item;
        }
      }
    }
    return fallback;
  }

  _inlineEntryAt(tableExpr, position) {
    let fallback = null;
    for (const entry of tableExpr.items || []) {
      if (this._contains(entry.value.range, position) || this._contains(entry.keyRange, position)) {
        return entry;
      }
      if (entry.keyRange && entry.keyRange.start && entry.keyRange.start.line === position.line && entry.keyRange.start.character <= position.character) {
        if (fallback === null || entry.keyRange.start.character >= fallback.keyRange.start.character) {
          fallback = entry;
        }
      }
    }
    return fallback;
  }

  _specForArrayValue(spec) {
    if (!spec) {
      return null;
    }
    if (spec.kind === "arrayOf") {
      return spec.item;
    }
    if (spec.kind === "oneOf") {
      const arrayOption = spec.options.find((option) => option && option.kind === "arrayOf");
      if (arrayOption) {
        return arrayOption.item;
      }
    }
    return spec;
  }

  _specForInlineTableValue(spec, tableExpr, currentKey) {
    if (!spec) {
      return null;
    }
    if (spec.kind === "objectShape" || spec.kind === "recordOf" || spec.kind === "object") {
      return spec;
    }
    if (spec.kind === "oneOf") {
      if (currentKey === "action") {
        return spec;
      }
      const option = this._selectInlineTableOption(spec.options, tableExpr, currentKey);
      return option || spec;
    }
    return spec;
  }

  _specForInlineEntry(spec, tableExpr, entryKey, currentKey) {
    if (!spec) {
      return null;
    }
    if (spec.kind === "objectShape") {
      return spec.required[entryKey] || spec.optional[entryKey] || null;
    }
    if (spec.kind === "recordOf") {
      return spec.valueSpec;
    }
    if (spec.kind === "oneOf") {
      if (currentKey === "action" && entryKey === "action") {
        return spec;
      }
      const option = this._selectInlineTableOption(spec.options, tableExpr, currentKey);
      if (!option) {
        return entryKey === "action" ? spec : null;
      }
      if (option.kind === "objectShape") {
        return option.required[entryKey] || option.optional[entryKey] || null;
      }
      if (option.kind === "recordOf") {
        return option.valueSpec;
      }
      return option;
    }
    if (spec.kind === "object") {
      return spec;
    }
    return null;
  }

  _selectInlineTableOption(options, tableExpr, currentKey) {
    if (!Array.isArray(options) || !options.length) {
      return null;
    }
    const objectOptions = [];
    for (const option of options) {
      if (!option) {
        continue;
      }
      if (option.kind === "objectShape") {
        objectOptions.push(option);
        continue;
      }
      if (option.kind === "oneOf") {
        for (const nested of option.options || []) {
          if (nested && nested.kind === "objectShape") {
            objectOptions.push(nested);
          }
        }
      }
    }
    if (!objectOptions.length) {
      return null;
    }
    if (currentKey === "action") {
      return null;
    }
    let best = null;
    for (const option of objectOptions) {
      const score = this._scoreObjectShapeOption(option, tableExpr, currentKey);
      if (score < 0) {
        continue;
      }
      if (best === null || score > best.score) {
        best = { option, score };
      }
    }
    if (!best || best.score <= 0) {
      return null;
    }
    return best.option;
  }

  _scoreObjectShapeOption(option, tableExpr, currentKey) {
    const required = option.required || {};
    const optional = option.optional || {};
    const siblingEntries = (tableExpr.items || []).filter((entry) => entry.key !== currentKey);
    let score = 0;
    for (const entry of siblingEntries) {
      const entrySpec = required[entry.key] || optional[entry.key];
      if (!entrySpec) {
        if (!option.allowUnknownKeys) {
          return -1;
        }
        continue;
      }
      if (validateValueSpec(entry.value, entrySpec, { range: entry.value.range }) !== null) {
        return -1;
      }
      score += 1;
    }
    return score;
  }

  _referenceCompletions(analyzed, completionContext, allowedRoots = null) {
    const suggestions = [];
    const seen = new Set();
    const isAllowed = (root) => {
      if (!allowedRoots || !allowedRoots.length) {
        return true;
      }
      return allowedRoots.some((allowed) => root === allowed || root.startsWith(`${allowed}.`));
    };
    const add = (label, detail, root) => {
      if (seen.has(label)) {
        return;
      }
      if (!isAllowed(root)) {
        return;
      }
      seen.add(label);
      suggestions.push([label, detail]);
    };

    add("DOCUMENT.PREFIXES", "Resolves to [app.prefixes]", "DOCUMENT.PREFIXES");
    add("DOCUMENT.PREFIXES.BASE_API", "Common API prefix", "DOCUMENT.PREFIXES");
    add("DOCUMENT.PREFIXES.ORIGIN", "Common origin prefix", "DOCUMENT.PREFIXES");
    for (const assignment of [...analyzed.assignmentIndex.values()].sort((left, right) => comparePaths(left.fullPath, right.fullPath))) {
      if (assignment.tablePath && assignment.tablePath.length === 2 && assignment.tablePath[0] === "app" && assignment.tablePath[1] === "prefixes") {
        add(`DOCUMENT.PREFIXES.${assignment.key}`, "Defined prefix", "DOCUMENT.PREFIXES");
      }
    }

    add("DOCUMENT.REGEXES", "Resolves to [app.regexes]", "DOCUMENT.REGEXES");
    add("DOCUMENT.REGEXES.TEXT_REQUEST", "Common request-text regex", "DOCUMENT.REGEXES");
    for (const table of [...analyzed.tableIndex.values()].sort((left, right) => comparePaths(left.path, right.path))) {
      const path = table.path || [];
      if (path.length === 3 && path[0] === "app" && path[1] === "regexes") {
        add(`DOCUMENT.REGEXES.${path[2]}`, "Defined regex", "DOCUMENT.REGEXES");
      }
    }

    add("VARIABLES", "Resolves to [app.variables]", "VARIABLES");
    for (const table of [...analyzed.tableIndex.values()].sort((left, right) => comparePaths(left.path, right.path))) {
      const path = table.path || [];
      if (path.length === 3 && path[0] === "app" && path[1] === "variables") {
        add(`VARIABLES.${path[2]}`, "Defined variable", "VARIABLES");
      }
    }

    add("GROUPS", "Resolves to [app.groups]", "GROUPS");
    for (const table of [...analyzed.tableIndex.values()].sort((left, right) => comparePaths(left.path, right.path))) {
      const path = table.path || [];
      if (path.length >= 3 && path[0] === "app" && path[1] === "groups") {
        add(`GROUPS.${path.slice(2).join(".")}`, "Defined group", "GROUPS");
      }
    }

    add("INPUT", "Resolves to the current function input namespace", "INPUT");
    add("INPUT.query", "Common text query input", "INPUT");
    add("INPUT.color", "Common color input", "INPUT");
    const functionId = functionIdFromTablePath(completionContext.assignment && completionContext.assignment.tablePath ? completionContext.assignment.tablePath : []);
    if (functionId) {
      for (const table of [...analyzed.tableIndex.values()].sort((left, right) => comparePaths(left.path, right.path))) {
        const path = table.path || [];
        if (path.length === 5 && path[0] === "app" && path[1] === "func" && path[2] === functionId && path[3] === "input") {
          add(`INPUT.${path[4]}`, "Function input", "INPUT");
        }
      }
    }

    if (isFuncResultReferenceContext(completionContext.assignment ? completionContext.assignment.tablePath || [] : [], completionContext.target ? completionContext.target.valuePathSegments || [] : [])) {
      for (const table of [...analyzed.tableIndex.values()].sort((left, right) => comparePaths(left.path, right.path))) {
        const path = table.path || [];
        if (path.length === 3 && path[0] === "app" && path[1] === "func") {
          const functionLabel = pathLabel([path[2]]);
          add(`FUNCRESULT.${functionLabel}.JSON`, `JSON result of ${pathLabel(path)}`, "FUNCRESULT");
          add(`FUNCRESULT.${functionLabel}.TEXT`, `Text result of ${pathLabel(path)}`, "FUNCRESULT");
          add(`FUNCRESULT.${functionLabel}.IMAGE`, `Image result of ${pathLabel(path)}`, "FUNCRESULT");
        }
      }
    }

    for (const entry of referenceNamespaceEntries("UNSTANDARD_HEADERS", REFERENCE_NAMESPACE_SPECS.UNSTANDARD_HEADERS.detail, REFERENCE_NAMESPACE_SPECS.UNSTANDARD_HEADERS.children)) {
      add(entry.label, entry.detail, entry.root);
    }
    for (const entry of referenceNamespaceEntries("CAPTURED_URLS", REFERENCE_NAMESPACE_SPECS.CAPTURED_URLS.detail, REFERENCE_NAMESPACE_SPECS.CAPTURED_URLS.children)) {
      add(entry.label, entry.detail, entry.root);
    }
    add("COOKIES", "Runtime cookie store", "COOKIES");
    add("LOCAL_STORAGE", "Runtime local storage", "LOCAL_STORAGE");
    add("SESSION_STORAGE", "Runtime session storage", "SESSION_STORAGE");

    return suggestions;
  }

  _tableCompletions(analyzed) {
    const suggestions = [
      ["app", "Top-level application namespace"],
      ["misklerreverseapi", "Document root table"],
      ["warmup", "Warmup settings"],
      ["variables", "Variable definitions"],
      ["prefixes", "Reusable prefixes"],
      ["regexes", "Reusable regex definitions"],
      ["groups", "Function groups"],
      ["func", "Function definitions"],
      ["input", "Function input namespace"],
      ["body", "Function body definitions"],
      ["headers", "Function headers block"],
      ["url", "Function URL block"],
      ["params", "Function URL parameter namespace"],
      ["examples", "Function examples"],
      ["from_global", "Shared input binding"],
    ];
    const tablePaths = [...analyzed.tableIndex.values()]
      .map((table) => table.pathSegments || table.path)
      .sort(comparePaths);
    for (const path of tablePaths) {
      suggestions.push([pathLabel(path), "Existing table"]);
    }
    return suggestions;
  }

  _valueCompletions() {
    return [
      ["true", "Boolean true"],
      ["false", "Boolean false"],
      ["null", "Null value"],
    ];
  }

  _literalSuggestionsForField(tablePath, key, spec) {
    if (key === "action" && spec && spec.kind === "oneOf") {
      const actionSuggestions = this._actionLiteralSuggestions(spec);
      if (actionSuggestions.length > 0) {
        return actionSuggestions;
      }
    }
    const special = this._specialLiteralSuggestions(tablePath, key, spec);
    if (special !== null) {
      return special;
    }
    const suggestions = this._literalSuggestionsForSpec(spec);
    if (suggestions.length > 0) {
      return suggestions;
    }
    return [];
  }

  _actionLiteralSuggestions(spec) {
    const suggestions = [];
    const seen = new Set();
    const visit = (node) => {
      if (!node) {
        return;
      }
      if (node.kind === "oneOf") {
        for (const option of node.options || []) {
          visit(option);
        }
        return;
      }
      if (node.kind === "arrayOf") {
        visit(node.item);
        return;
      }
      if (node.kind === "objectShape") {
        const actionSpec = (node.required && node.required.action) || null;
        for (const [label, detail] of this._literalSuggestionsForSpec(actionSpec)) {
          if (seen.has(label)) {
            continue;
          }
          seen.add(label);
          suggestions.push([label, detail]);
        }
      }
    };
    visit(spec);
    return suggestions;
  }

  _specialLiteralSuggestions(tablePath, key, spec) {
    if (spec && spec.kind === "pattern" && typeof spec.description === "string") {
      if (spec.description.includes("browser-supported MIME type")) {
        return [
          ["application/json", "MIME type"],
          ["application/x-www-form-urlencoded", "MIME type"],
          ["multipart/form-data", "MIME type"],
          ["text/html", "MIME type"],
        ];
      }
      if (spec.description.includes("template containing")) {
        return [
          ["{class_name}", "Class name template"],
          ["{class_name.lower}", "Lowercase class name template"],
          ["{class_name.upper}", "Uppercase class name template"],
        ];
      }
      if (spec.description.includes("path ending in .jpg, .jpeg, or .png")) {
        return [
          ["screenshot.png", "PNG screenshot path"],
          ["screenshot.jpg", "JPEG screenshot path"],
        ];
      }
    }
    if (pathStartsWith(tablePath, ["app", "func", "*", "body"]) && key === "type") {
      return [
        ["application/json", "MIME type"],
        ["application/x-www-form-urlencoded", "MIME type"],
        ["multipart/form-data", "MIME type"],
        ["text/html", "MIME type"],
      ];
    }
    return null;
  }

  _literalSuggestionsForSpec(spec) {
    if (spec === null || spec === undefined) {
      return [];
    }
    if (spec.kind === "enum") {
      return spec.values.map((value) => [String(value), "Allowed enum value"]);
    }
    if (spec.kind === "boolean") {
      return [
        ["true", "Boolean true"],
        ["false", "Boolean false"],
      ];
    }
    if (spec.kind === "null") {
      return [["null", "Null value"]];
    }
    if (spec.kind === "number" || spec.kind === "integer") {
      return [];
    }
    if (spec.kind === "input-list-type") {
      const itemSuggestions = this._literalSuggestionsForSpec(spec.valueSpec);
      return itemSuggestions.map(([label, detail]) => [`list[${label}]`, `List of ${detail.toLowerCase()}`]);
    }
    if (spec.kind === "oneOf") {
      const suggestions = [];
      const seen = new Set();
      for (const option of spec.options) {
        for (const [label, detail] of this._literalSuggestionsForSpec(option)) {
          if (seen.has(label)) {
            continue;
          }
          seen.add(label);
          suggestions.push([label, detail]);
        }
      }
      return suggestions;
    }
    return [];
  }

  _allowedReferenceRoots(tablePath, valuePathSegments, key, spec, schema) {
    if (spec && spec.kind === "reference") {
      return spec.roots;
    }
    if (schema && Array.isArray(schema.rules) && schema.rules.some((rule) => rule.kind === "forbidDynamicValue" && rule.key === key)) {
      return [];
    }
    if (key === "group") {
      return ["GROUPS"];
    }
    if (key === "referrer") {
      return ["DOCUMENT.PREFIXES"];
    }
    if (key === "base" && (pathMatches(tablePath, ["app", "func", "*", "url"]) || pathMatches(tablePath, ["app", "warmup"]))) {
      return ["DOCUMENT.PREFIXES"];
    }
    if (key === "url" && pathMatches(tablePath, ["app", "warmup"])) {
      return ["DOCUMENT.PREFIXES"];
    }
    if (key === "data") {
      if (pathStartsWith(tablePath, ["app", "func", "*", "url", "params"]) || pathStartsWith(tablePath, ["app", "func", "*", "body"])) {
        return [
          "INPUT",
          "VARIABLES",
          "DOCUMENT.PREFIXES",
          "DOCUMENT.REGEXES",
          "UNSTANDARD_HEADERS",
          "CAPTURED_URLS",
          "COOKIES",
          "LOCAL_STORAGE",
          "SESSION_STORAGE",
        ];
      }
      if (pathStartsWith(tablePath, ["app", "func", "*", "input"])) {
        return ["INPUT", "VARIABLES", "DOCUMENT.PREFIXES", "DOCUMENT.REGEXES"];
      }
      return ["INPUT", "VARIABLES", "DOCUMENT.PREFIXES", "DOCUMENT.REGEXES"];
    }
    if (isFuncResultReferenceContext(tablePath, valuePathSegments)) {
      return EXAMPLE_INPUT_REFERENCE_ROOTS;
    }
    if (key === "from" && pathMatches(tablePath, ["app", "variables", "*"])) {
      return [
        "UNSTANDARD_HEADERS",
        "CAPTURED_URLS",
        "COOKIES",
        "LOCAL_STORAGE",
        "SESSION_STORAGE",
      ];
    }
    return null;
  }

  _completionItemsFromPairs(pairs, prefix, range, kind, insertPrefix = "", suffix = "", useSnippet = false) {
    const items = [];
    for (const [label, detail] of pairs) {
      if (prefix && !label.startsWith(prefix)) {
        continue;
      }
      items.push(this._completionItem(label, detail, kind, range, insertPrefix, suffix, useSnippet));
    }
    return items;
  }

  _completionItem(label, detail, kind, range, insertPrefix = "", suffix = "", useSnippet = false) {
    const continuation = referenceContinuationSuffix(label);
    const newText = `${insertPrefix}${label}${continuation}${useSnippet ? "$0" : ""}${suffix}`;
    const item = {
      label,
      kind,
      detail,
      textEdit: {
        range,
        newText,
      },
    };
    if (useSnippet) {
      item.insertTextFormat = 2;
    }
    return item;
  }

  _assignmentAt(document, position) {
    let fallback = null;
    for (const assignment of document.assignments.values()) {
      if (this._contains(assignment.valueRange, position) || this._contains(assignment.keyRange, position)) {
        return assignment;
      }
      if (
        assignment.keyRange &&
        assignment.keyRange.start &&
        assignment.keyRange.start.line === position.line &&
        assignment.keyRange.start.character <= position.character
      ) {
        if (
          fallback === null ||
          assignment.keyRange.start.character >= fallback.keyRange.start.character
        ) {
          fallback = assignment;
        }
      }
    }
    return fallback;
  }

  _hover(params) {
    const textDocument = params.textDocument || {};
    const uri = textDocument.uri;
    const document = this.documents.get(uri);
    if (document === undefined) {
      return null;
    }
    const position = this._positionFromLsp(params.position || {});
    const info = this._hoverAt(document, position);
    if (info === null) {
      return null;
    }
    return { contents: { kind: "markdown", value: info } };
  }

  _hoverAt(document, position) {
    for (const ref of document.parsed.references) {
      if (this._contains(ref.range, position)) {
        const rendered = renderRef(ref.expr);
        if (ref.resolvedPath) {
          const targetLabel = pathLabel(ref.resolvedPathSegments || ref.resolvedPath);
          return `**Reference** \`${rendered}\`\n\nResolves to \`${targetLabel}\` as ${ref.resolvedKind}.`;
        }
        return `**Reference** \`${rendered}\``;
      }
    }
    for (const assignment of document.parsed.assignments.values()) {
      if (this._contains(assignment.keyRange, position)) {
        const assignmentLabel = pathLabel([
          ...(assignment.tablePathSegments || []),
          { value: assignment.key, quoted: Boolean(assignment.quoted) },
        ]);
        return `**Assignment** \`${assignmentLabel}\``;
      }
    }
    return null;
  }

  _definition(params) {
    const textDocument = params.textDocument || {};
    const uri = textDocument.uri;
    const document = this.documents.get(uri);
    if (document === undefined) {
      return null;
    }
    const position = this._positionFromLsp(params.position || {});
    const locations = collectDefinitionLocations(document.analyzed);
    for (const ref of document.parsed.references) {
      if (this._contains(ref.range, position) && ref.resolvedPath) {
        const targetRange = locations.get(ref.resolvedPathKey || pathKey(ref.resolvedPath));
        if (targetRange !== undefined) {
          return [
            {
              uri,
              range: this._rangeToLsp(targetRange),
            },
          ];
        }
      }
    }
    return null;
  }

  _documentSymbol(params) {
    const textDocument = params.textDocument || {};
    const uri = textDocument.uri;
    const document = this.documents.get(uri);
    if (document === undefined) {
      return [];
    }
    const items = [];
    const tables = [...document.analyzed.tableIndex.values()].sort((left, right) => comparePaths(left.path, right.path));
    const assignments = [...document.analyzed.assignmentIndex.values()].sort((left, right) => comparePaths(left.fullPath, right.fullPath));
    for (const table of tables) {
      items.push({
        name: pathLabel(table.pathSegments || table.path),
        kind: 5,
        range: this._rangeToLsp(table.headerRange),
        selectionRange: this._rangeToLsp(table.headerRange),
      });
    }
    for (const assignment of assignments) {
      const fullRange = this._rangeCover([assignment.keyRange, assignment.valueRange]);
      const assignmentLabel = pathLabel([
        ...(assignment.tablePathSegments || []),
        { value: assignment.key, quoted: Boolean(assignment.quoted) },
      ]);
      items.push({
        name: assignmentLabel,
        kind: 13,
        range: this._rangeToLsp(fullRange),
        selectionRange: this._rangeToLsp(assignment.keyRange),
      });
    }
    return items;
  }

  _workspaceSymbol(params) {
    const query = String(params.query || "").toLowerCase();
    const items = [];
    for (const [uri, document] of this.documents.entries()) {
      const assignments = [...document.analyzed.assignmentIndex.values()].sort((left, right) => comparePaths(left.fullPath, right.fullPath));
      for (const assignment of assignments) {
        const label = pathLabel([
          ...(assignment.tablePathSegments || []),
          { value: assignment.key, quoted: Boolean(assignment.quoted) },
        ]);
        if (query && !label.toLowerCase().includes(query)) {
          continue;
        }
        items.push({
          name: label,
          kind: 13,
          location: {
            uri,
            range: this._rangeToLsp(assignment.keyRange),
          },
        });
      }
    }
    return items;
  }

  _rangeToLsp(range) {
    return {
      start: {
        line: range.start.line,
        character: range.start.character,
      },
      end: {
        line: range.end.line,
        character: range.end.character,
      },
    };
  }

  _rangeCover(ranges) {
    if (!ranges.length) {
      return new Range(new Position(0, 0), new Position(0, 0));
    }
    let start = ranges[0].start;
    let end = ranges[0].end;
    for (const range of ranges.slice(1)) {
      if (
        range.start.line < start.line ||
        (range.start.line === start.line && range.start.character < start.character)
      ) {
        start = range.start;
      }
      if (
        range.end.line > end.line ||
        (range.end.line === end.line && range.end.character > end.character)
      ) {
        end = range.end;
      }
    }
    return new Range(start, end);
  }

  _positionFromLsp(position) {
    return new Position(Number(position.line || 0), Number(position.character || 0));
  }

  _contains(range, position) {
    if (position.line < range.start.line || position.line > range.end.line) {
      return false;
    }
    if (range.start.line === range.end.line) {
      return range.start.character <= position.character && position.character <= range.end.character;
    }
    if (position.line === range.start.line && position.character < range.start.character) {
      return false;
    }
    if (position.line === range.end.line && position.character > range.end.character) {
      return false;
    }
    return true;
  }

  _uriToPath(uri) {
    try {
      return fileURLToPath(uri);
    } catch (error) {
      return null;
    }
  }
}

function findSchemaForPath(tablePath) {
  for (const schema of TABLE_SCHEMAS) {
    if (schema.match(tablePath)) {
      return schema;
    }
  }
  return null;
}

function pathMatches(path, pattern) {
  if (!Array.isArray(path) || !Array.isArray(pattern) || path.length !== pattern.length) {
    return false;
  }
  return pattern.every((segment, index) => segment === "*" || segment === path[index]);
}

function pathStartsWith(path, prefix) {
  if (!Array.isArray(path) || !Array.isArray(prefix) || prefix.length > path.length) {
    return false;
  }
  return prefix.every((segment, index) => segment === "*" || segment === path[index]);
}

function functionIdFromTablePath(tablePath) {
  if (!Array.isArray(tablePath)) {
    return null;
  }
  for (let index = 0; index < tablePath.length - 2; index += 1) {
    if (tablePath[index] === "app" && tablePath[index + 1] === "func") {
      return tablePath[index + 2];
    }
  }
  return null;
}

function main() {
  const connection = createMessageConnection(
    new StreamMessageReader(process.stdin),
    new StreamMessageWriter(process.stdout),
  );
  const server = new MsraLanguageServer(connection);
  server.listen();
}

if (require.main === module) {
  main();
}

module.exports = {
  MsraLanguageServer,
  main,
};
