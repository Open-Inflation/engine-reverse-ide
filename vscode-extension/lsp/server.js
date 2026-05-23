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
const { parseDocument } = require("./parser");
const {
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
    const prefix = text.slice(start, offset);
    const range = this._rangeToLsp(document.rangeFromOffsets(start, offset));
    const lineStart = position.line < document.lineStarts.length ? document.lineStarts[position.line] : 0;
    const linePrefix = text.slice(lineStart, offset);
    if (linePrefix.includes("<") && linePrefix.lastIndexOf("<") > linePrefix.lastIndexOf(">")) {
      return { prefix, context: "reference", range };
    }
    if (linePrefix.includes("[") && linePrefix.lastIndexOf("[") > linePrefix.lastIndexOf("]")) {
      return { prefix, context: "table", range };
    }
    return { prefix, context: "value", range };
  }

  _completionItems(analyzed, completionContext) {
    const { prefix, context, range } = completionContext;
    const items = [];
    if (context === "reference") {
      for (const [label, detail] of this._referenceCompletions(analyzed)) {
        if (prefix && !label.startsWith(prefix)) {
          continue;
        }
        items.push(this._completionItem(label, detail, 21, range));
      }
      return items;
    }
    if (context === "table") {
      for (const [label, detail] of this._tableCompletions(analyzed)) {
        if (prefix && !label.startsWith(prefix)) {
          continue;
        }
        items.push(this._completionItem(label, detail, 21, range));
      }
      return items;
    }
    for (const [label, detail] of this._valueCompletions()) {
      if (prefix && !label.startsWith(prefix)) {
        continue;
      }
      items.push(this._completionItem(label, detail, 12, range));
    }
    return items;
  }

  _referenceCompletions(analyzed) {
    const suggestions = [
      ["DOCUMENT", "Virtual namespace for document-level prefixes and regexes"],
      ["DOCUMENT.PREFIXES", "Resolves to [app.prefixes]"],
      ["DOCUMENT.PREFIXES.ORIGIN", "Current document origin prefix"],
      ["DOCUMENT.PREFIXES.BASE_API", "Base API prefix"],
      ["DOCUMENT.REGEXES", "Resolves to [app.regexes]"],
      ["DOCUMENT.REGEXES.TEXT_REQUEST", "Text filter regex"],
      ["VARIABLES", "Resolves to [app.variables]"],
      ["GROUPS", "Resolves to [app.groups]"],
      ["GROUPS.Catalog.Product", "Reference to a named function group"],
      ["INPUT", "Resolves to the current function input namespace"],
      ["UNSTANDART_HEADERS", "Runtime request/response headers"],
      ["CAPTURED_URLS", "Runtime captured URL list"],
      ["COOKIES", "Runtime cookie store"],
      ["LOCAL_STORAGE", "Runtime local storage"],
      ["SESSION_STORAGE", "Runtime session storage"],
    ];
    const tablePaths = [...analyzed.tableIndex.values()]
      .map((table) => table.path)
      .sort(comparePaths);
    const assignmentPaths = [...analyzed.assignmentIndex.values()]
      .map((assignment) => assignment.fullPath)
      .sort(comparePaths);
    for (const path of tablePaths) {
      suggestions.push([pathLabel(path), "Defined table"]);
    }
    for (const path of assignmentPaths) {
      suggestions.push([pathLabel(path), "Defined value"]);
    }
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
      .map((table) => table.path)
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
      ["<DOCUMENT.PREFIXES.ORIGIN>", "Origin prefix reference"],
      ["<DOCUMENT.PREFIXES.BASE_API>", "Base API prefix reference"],
      ["<DOCUMENT.REGEXES.TEXT_REQUEST>", "Text request regex reference"],
      ["<VARIABLES.city_id>", "Variable reference"],
      ["<INPUT.query>", "Current input reference"],
    ];
  }

  _completionItem(label, detail, kind, range) {
    return {
      label,
      kind,
      detail,
      textEdit: {
        range,
        newText: label,
      },
    };
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
          return `**Reference** \`${rendered}\`\n\nResolves to \`${ref.resolvedPath.join(".")}\` as ${ref.resolvedKind}.`;
        }
        return `**Reference** \`${rendered}\``;
      }
    }
    for (const assignment of document.parsed.assignments.values()) {
      if (this._contains(assignment.keyRange, position)) {
        return `**Assignment** \`${assignment.fullPath.join(".")}\``;
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
        const targetRange = locations.get(pathKey(ref.resolvedPath));
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
        name: pathLabel(table.path),
        kind: 5,
        range: this._rangeToLsp(table.headerRange),
        selectionRange: this._rangeToLsp(table.headerRange),
      });
    }
    for (const assignment of assignments) {
      const fullRange = this._rangeCover([assignment.keyRange, assignment.valueRange]);
      items.push({
        name: assignment.key,
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
        const label = pathLabel(assignment.fullPath);
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
