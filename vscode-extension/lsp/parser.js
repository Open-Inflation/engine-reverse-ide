const {
  ArrayExpr,
  AssignmentDef,
  BoolExpr,
  CallExpr,
  Diagnostic,
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
  pathLabel,
} = require("./model");
const { pathIdentityKey } = require("./path-schema");

const ATOM_STARTS = new Set([
  "STRING",
  "NUMBER",
  "LBRACE",
  "LBRACK",
  "LT",
  "LPAREN",
]);

class Tokenizer {
  constructor(text) {
    this.text = text;
    this.length = text.length;
    this.offset = 0;
    this.line = 0;
    this.character = 0;
    this.tokens = [];
    this.diagnostics = [];
  }

  _position() {
    return new Position(this.line, this.character);
  }

  _emit(tokenType, value, start, end) {
    this.tokens.push(new Token(tokenType, value, new Range(start, end)));
  }

  _advanceChar() {
    const char = this.text[this.offset];
    this.offset += 1;
    if (char === "\r") {
      if (this.offset < this.length && this.text[this.offset] === "\n") {
        this.offset += 1;
        this.line += 1;
        this.character = 0;
        return "\n";
      }
      this.line += 1;
      this.character = 0;
      return "\n";
    }
    if (char === "\n") {
      this.line += 1;
      this.character = 0;
      return "\n";
    }
    this.character += 1;
    return char;
  }

  _peekChar(offset = 0) {
    const index = this.offset + offset;
    if (index >= this.length) {
      return null;
    }
    return this.text[index];
  }

  _takeWhile(predicate) {
    const start = this.offset;
    while (this.offset < this.length && predicate(this.text[this.offset])) {
      this._advanceChar();
    }
    return this.text.slice(start, this.offset);
  }

  tokenize() {
    while (this.offset < this.length) {
      const char = this._peekChar();
      if (char === null) {
        break;
      }
      if (char === " " || char === "\t") {
        this._advanceChar();
        continue;
      }
      if (char === "\r" || char === "\n") {
        const start = this._position();
        this._advanceChar();
        const end = this._position();
        this._emit("NEWLINE", "\n", start, end);
        continue;
      }
      if (char === "@") {
        const start = this._position();
        this._advanceChar();
        this._emit("AT", "@", start, this._position());
        continue;
      }
      if (char === "#") {
        while (true) {
          const next = this._peekChar();
          if (next === null || next === "\n" || next === "\r") {
            break;
          }
          this._advanceChar();
        }
        continue;
      }
      if (char === "[") {
        const start = this._position();
        this._advanceChar();
        this._emit("LBRACK", "[", start, this._position());
        continue;
      }
      if (char === "]") {
        const start = this._position();
        this._advanceChar();
        this._emit("RBRACK", "]", start, this._position());
        continue;
      }
      if (char === "{") {
        const start = this._position();
        this._advanceChar();
        this._emit("LBRACE", "{", start, this._position());
        continue;
      }
      if (char === "}") {
        const start = this._position();
        this._advanceChar();
        this._emit("RBRACE", "}", start, this._position());
        continue;
      }
      if (char === "(") {
        const start = this._position();
        this._advanceChar();
        this._emit("LPAREN", "(", start, this._position());
        continue;
      }
      if (char === ")") {
        const start = this._position();
        this._advanceChar();
        this._emit("RPAREN", ")", start, this._position());
        continue;
      }
      if (char === "<") {
        const start = this._position();
        this._advanceChar();
        this._emit("LT", "<", start, this._position());
        continue;
      }
      if (char === ">") {
        const start = this._position();
        this._advanceChar();
        this._emit("GT", ">", start, this._position());
        continue;
      }
      if (char === "=") {
        const start = this._position();
        this._advanceChar();
        this._emit("EQ", "=", start, this._position());
        continue;
      }
      if (char === ":") {
        const start = this._position();
        this._advanceChar();
        this._emit("COLON", ":", start, this._position());
        continue;
      }
      if (char === ",") {
        const start = this._position();
        this._advanceChar();
        this._emit("COMMA", ",", start, this._position());
        continue;
      }
      if (char === "+") {
        const start = this._position();
        this._advanceChar();
        this._emit("PLUS", "+", start, this._position());
        continue;
      }
      if (char === ".") {
        const start = this._position();
        this._advanceChar();
        this._emit("DOT", ".", start, this._position());
        continue;
      }
      if (char === '"') {
        this._lexString();
        continue;
      }
      if (this._isDigit(char) || ((char === "+" || char === "-") && this._isDigit(this._peekChar(1) || ""))) {
        this._lexNumber();
        continue;
      }
      if (this._isIdentifierStart(char)) {
        this._lexIdentifier();
        continue;
      }
      const start = this._position();
      this._advanceChar();
      this.diagnostics.push(
        new Diagnostic(`Unexpected character ${JSON.stringify(char)}`, new Range(start, this._position()), "error", "msra", "unexpected-character"),
      );
    }
    const eof = this._position();
    this._emit("EOF", "", eof, eof);
    const lineStarts = [0];
    for (let index = 0; index < this.text.length; index += 1) {
      if (this.text[index] === "\n") {
        lineStarts.push(index + 1);
      }
    }
    return [this.tokens, this.diagnostics, lineStarts];
  }

  _isDigit(char) {
    return char >= "0" && char <= "9";
  }

  _isIdentifierStart(char) {
    return /[A-Za-z_]/.test(char) || char.codePointAt(0) > 127;
  }

  _isIdentifierPart(char) {
    return /[A-Za-z0-9_]/.test(char) || char === "-" || char.codePointAt(0) > 127;
  }

  _lexIdentifier() {
    const start = this._position();
    const value = this._takeWhile((char) => this._isIdentifierPart(char));
    this._emit("IDENT", value, start, this._position());
  }

  _lexNumber() {
    const start = this._position();
    const text = this.text;
    const offset = this.offset;
    if (text[offset] === "+" || text[offset] === "-") {
      this._advanceChar();
    }
    let sawDigit = false;
    while (this._peekChar() !== null && this._isDigit(this._peekChar())) {
      sawDigit = true;
      this._advanceChar();
    }
    if (this._peekChar() === "." && this._isDigit(this._peekChar(1) || "")) {
      this._advanceChar();
      while (this._peekChar() !== null && this._isDigit(this._peekChar())) {
        sawDigit = true;
        this._advanceChar();
      }
    }
    if (this._peekChar() === "e" || this._peekChar() === "E") {
      const lookahead = this._peekChar(1);
      if (lookahead !== null && (this._isDigit(lookahead) || lookahead === "+" || lookahead === "-")) {
        this._advanceChar();
        if (this._peekChar() === "+" || this._peekChar() === "-") {
          this._advanceChar();
        }
        while (this._peekChar() !== null && this._isDigit(this._peekChar())) {
          sawDigit = true;
          this._advanceChar();
        }
      }
    }
    const raw = text.slice(offset, this.offset);
    if (!sawDigit) {
      this.diagnostics.push(
        new Diagnostic(`Invalid numeric literal ${JSON.stringify(raw)}`, new Range(start, this._position()), "error", "msra", "invalid-number"),
      );
    }
    this._emit("NUMBER", raw, start, this._position());
  }

  _lexString() {
    const start = this._position();
    this._advanceChar();
    const chars = [];
    while (true) {
      const char = this._peekChar();
      if (char === null) {
        this.diagnostics.push(
          new Diagnostic("Unterminated string literal", new Range(start, this._position()), "error", "msra", "unterminated-string"),
        );
        break;
      }
      if (char === '"') {
        break;
      }
      if (char === "\\") {
        this._advanceChar();
        const escaped = this._peekChar();
        if (escaped === null) {
          break;
        }
        this._advanceChar();
        chars.push(this._decodeEscape(escaped));
        continue;
      }
      if (char === "\r" || char === "\n") {
        this.diagnostics.push(
          new Diagnostic("Unterminated string literal", new Range(start, this._position()), "error", "msra", "unterminated-string"),
        );
        break;
      }
      chars.push(char);
      this._advanceChar();
    }
    if (this._peekChar() === '"') {
      this._advanceChar();
    }
    this._emit("STRING", chars.join(""), start, this._position());
  }

  _decodeEscape(char) {
    const mapping = {
      n: "\n",
      r: "\r",
      t: "\t",
      '"': '"',
      "\\": "\\",
    };
    return Object.prototype.hasOwnProperty.call(mapping, char) ? mapping[char] : char;
  }
}

class Parser {
  constructor(state) {
    this.state = state;
    this.tokens = state.tokens;
    this.index = 0;
    this.text = state.text;
    this.diagnostics = state.diagnostics;
    this.tables = new Map();
    this.assignments = new Map();
    this.references = [];
    this.currentTable = [];
    this.currentTableSegments = [];
    this.currentTableIdentityKey = pathIdentityKey([]);
    this.currentValuePathSegments = [];
  }

  parse() {
    while (!this._check("EOF")) {
      this._skipNewlines();
      if (this._check("EOF")) {
        break;
      }
      if (this._check("LBRACK")) {
        this._parseTableHeader();
        continue;
      }
      if (this._check("AT")) {
        this._parseAnnotationOrRecover();
        continue;
      }
      this._parseAssignmentOrRecover();
    }
    return new ParsedDocument({
      uri: this.state.uri,
      text: this.text,
      lineStarts: this.state.lineStarts,
      tokens: this.tokens,
      diagnostics: this.diagnostics,
      tables: this.tables,
      assignments: this.assignments,
      references: this.references,
      errors: this.diagnostics,
    });
  }

  _current() {
    return this.tokens[this.index];
  }

  _previous() {
    return this.tokens[Math.max(0, this.index - 1)];
  }

  _advance() {
    const token = this.tokens[this.index];
    if (!this._check("EOF")) {
      this.index += 1;
    }
    return token;
  }

  _check(tokenType) {
    return this._current().type === tokenType;
  }

  _match(...types) {
    if (types.includes(this._current().type)) {
      this._advance();
      return true;
    }
    return false;
  }

  _skipNewlines() {
    while (this._match("NEWLINE")) {
      // Keep consuming blank lines.
    }
  }

  _parseTableHeader() {
    const start = this._advance();
    const pathSegments = this._parsePath("RBRACK");
    const end = this._expect("RBRACK", "Expected ']' to close table header");
    const tableRange = new Range(start.range.start, end ? end.range.end : this._previous().range.end);
    if (!pathSegments.length) {
      this._error("Empty table header", tableRange, "empty-table-header");
      this._syncToNextStatement();
      return;
    }
    const tablePath = pathSegments.map((segment) => segment.value);
    const tableKey = pathIdentityKey(pathSegments);
    if (this.tables.has(tableKey)) {
      this._error(
        `Duplicate table declaration for ${pathLabel(pathSegments)}`,
        tableRange,
        "duplicate-table",
      );
    } else {
      this.tables.set(tableKey, new TableDef(tablePath, tableRange, pathSegments, tableKey));
    }
    this.currentTable = tablePath;
    this.currentTableSegments = pathSegments;
    this.currentTableIdentityKey = tableKey;
    if (!this._match("NEWLINE", "EOF")) {
      this._error("Expected end of line after table header", this._current().range, "trailing-table-header");
      this._syncToNextStatement();
    }
  }

  _parseAssignmentOrRecover() {
    const keyToken = this._parseKeyToken();
    if (keyToken === null) {
      this._error("Expected key or table header", this._current().range, "expected-key");
      this._syncToNextStatement();
      return;
    }
    if (!this._match("EQ")) {
      this._error("Expected '=' after key", this._current().range, "expected-equals");
      this._syncToNextStatement();
      return;
    }
    const valueStartIndex = this.index;
    const value = this._withValuePathSegment(
      {
        value: keyToken.value,
        quoted: keyToken.type === "STRING",
        range: keyToken.range,
      },
      () => this._parseExpr(true, true, true),
    );
    this._registerAssignment(keyToken, value, keyToken.type === "STRING");
    if (this._check("NEWLINE")) {
      this._advance();
    } else if (!this._check("EOF")) {
      if (!(value instanceof NullExpr && this.index === valueStartIndex)) {
        this._error("Expected end of line after assignment", this._current().range, "trailing-assignment");
      }
      this._syncToNextStatement();
    }
  }

  _parseKeyToken() {
    if (this._check("IDENT") || this._check("STRING")) {
      return this._advance();
    }
    return null;
  }

  _parseAnnotationOrRecover() {
    const atToken = this._advance();
    const nameToken = this._parseKeyToken();
    if (nameToken === null) {
      this._error("Expected annotation name after '@'", this._current().range, "expected-annotation-name");
      this._syncToNextStatement();
      return;
    }
    const annotationKey = this._annotationKeyForName(nameToken.value);
    if (annotationKey === null) {
      this._error(`Unknown annotation @${nameToken.value}`, nameToken.range, "unknown-annotation");
      this._syncToNextStatement();
      return;
    }
    const annotationRange = new Range(atToken.range.start, nameToken.range.end);
    let value = new BoolExpr(annotationRange, true);
    let annotationHasArguments = false;
    if (this._match("LPAREN")) {
      annotationHasArguments = true;
      if (this._check("RPAREN")) {
        this._advance();
      } else {
        value = this._withValuePathSegment(
          {
            value: annotationKey,
            quoted: false,
            range: annotationRange,
          },
          () => this._parseExpr(false, true, true),
        );
        this._expect("RPAREN", "Expected ')' to close annotation");
      }
    }
    this._registerAssignment(
      {
        value: annotationKey,
        range: annotationRange,
        type: "IDENT",
      },
      value,
      false,
      true,
      nameToken.value,
      annotationHasArguments,
    );
    if (this._check("NEWLINE")) {
      this._advance();
    } else if (!this._check("EOF")) {
      this._error("Expected end of line after annotation", this._current().range, "trailing-annotation");
      this._syncToNextStatement();
    }
  }

  _annotationKeyForName(name) {
    const normalized = String(name || "")
      .toLowerCase()
      .replace(/[_-]/g, "");
    const annotationMap = {
      suburl: "sub_url",
      required: "required",
      list: "list",
      readonly: "read_only",
      humanize: "humanize",
      blockimages: "block_images",
      sniffheaders: "headers_sniffer",
      headerssniffer: "headers_sniffer",
    };
    return annotationMap[normalized] || null;
  }

  _registerAssignment(keyToken, value, quoted = false, annotation = false, annotationName = null, annotationHasArguments = false) {
    const key = keyToken.value;
    const keyRange = keyToken.range;
    const assignmentRange = new Range(keyRange.start, value ? value.range.end : this._previous().range.end);
    const fullPath = [...this.currentTable, key];
    const tablePathSegments = this.currentTableSegments.slice();
    const tableIdentityKey = this.currentTableIdentityKey;
    const assignmentIdentityKey = JSON.stringify([tableIdentityKey, key]);
    const assignment = new AssignmentDef(
      [...this.currentTable],
      key,
      keyRange,
      value,
      value.range,
      fullPath,
      quoted,
      tablePathSegments,
      tableIdentityKey,
      assignmentIdentityKey,
      annotation,
      annotationName,
      annotationHasArguments,
    );
    if (this.assignments.has(assignmentIdentityKey)) {
      this._error(
        `Duplicate assignment for ${pathLabel([...tablePathSegments, { value: key, quoted }])}`,
        assignmentRange,
        "duplicate-assignment",
      );
    } else {
      this.assignments.set(assignmentIdentityKey, assignment);
    }
    if (!this.tables.has(tableIdentityKey)) {
      this.tables.set(tableIdentityKey, new TableDef([...this.currentTable], keyRange, tablePathSegments, tableIdentityKey));
    }
    this.tables.get(tableIdentityKey).assignments.push(assignment);
    return assignment;
  }

  _parsePath(until) {
    const path = [];
    if (this._check(until) || this._check("EOF")) {
      return path;
    }
    const segment = this._parsePathSegment();
    if (segment === null) {
      return path;
    }
    path.push(segment);
    while (this._match("DOT")) {
      const nextSegment = this._parsePathSegment();
      if (nextSegment === null) {
        this._error("Expected path segment after '.'", this._current().range, "expected-path-segment");
        break;
      }
      path.push(nextSegment);
    }
    return path;
  }

  _parsePathSegment() {
    if (this._check("IDENT") || this._check("STRING")) {
      const token = this._advance();
      return {
        value: token.value,
        quoted: token.type === "STRING",
        range: token.range,
      };
    }
    return null;
  }

  _parseExpr(stopOnNewline, allowIdentifiers = false, bareStrings = false) {
    const parts = [this._parseConcat(stopOnNewline, allowIdentifiers, bareStrings)];
    while (this._match("PLUS")) {
      parts.push(this._parseConcat(stopOnNewline, allowIdentifiers, bareStrings));
    }
    if (parts.length === 1) {
      return parts[0];
    }
    const start = parts[0].range.start;
    const end = parts[parts.length - 1].range.end;
    return new MergeExpr(new Range(start, end), parts);
  }

  _parseConcat(stopOnNewline, allowIdentifiers = false, bareStrings = false) {
    const items = [];
    const first = this._parseAtom(stopOnNewline, allowIdentifiers, bareStrings);
    if (first === null) {
      const emptyRange = this._current().range;
      this._error("Expected value", emptyRange, "expected-value");
      return new NullExpr(emptyRange);
    }
    items.push(first);
    while (true) {
      if (this._atValueTerminator(stopOnNewline)) {
        break;
      }
      if (["COMMA", "RBRACE", "RBRACK", "RPAREN", "EOF"].includes(this._current().type)) {
        break;
      }
      if (this._current().type === "NEWLINE" && stopOnNewline) {
        break;
      }
      if (this._current().type === "IDENT" && !allowIdentifiers) {
        break;
      }
      if (!ATOM_STARTS.has(this._current().type) && this._current().type !== "IDENT") {
        break;
      }
      const next = this._parseAtom(stopOnNewline, allowIdentifiers);
      if (next === null) {
        break;
      }
      items.push(next);
    }
    if (items.length === 1) {
      return items[0];
    }
    return new SequenceExpr(new Range(items[0].range.start, items[items.length - 1].range.end), items);
  }

  _atValueTerminator(stopOnNewline) {
    if (this._check("EOF")) {
      return true;
    }
    if (stopOnNewline && this._check("NEWLINE")) {
      return true;
    }
    return false;
  }

  _parseAtom(stopOnNewline, allowIdentifiers = false, bareStrings = false) {
    const token = this._current();
    if (token.type === "STRING") {
      this._advance();
      return new StringExpr(token.range, token.value, token.value, true);
    }
    if (token.type === "NUMBER") {
      this._advance();
      const raw = token.value;
      let value;
      if (/[.eE]/.test(raw)) {
        const parsed = Number.parseFloat(raw);
        value = Number.isNaN(parsed) ? 0.0 : parsed;
      } else {
        const parsed = Number.parseInt(raw, 10);
        value = Number.isNaN(parsed) ? 0 : parsed;
      }
      return new NumberExpr(token.range, value, raw);
    }
    if (token.type === "IDENT") {
      if (!allowIdentifiers) {
        if (token.value === "true") {
          this._advance();
          return new BoolExpr(token.range, true);
        }
        if (token.value === "false") {
          this._advance();
          return new BoolExpr(token.range, false);
        }
        if (token.value === "null") {
          this._advance();
          return new NullExpr(token.range);
        }
        return null;
      }
      this._advance();
      if (token.value === "true") {
        return new BoolExpr(token.range, true);
      }
      if (token.value === "false") {
        return new BoolExpr(token.range, false);
      }
      if (token.value === "null") {
        return new NullExpr(token.range);
      }
      if (bareStrings) {
        return new StringExpr(token.range, token.value, token.value, false);
      }
      let expr = new IdentExpr(token.range, token.value);
      if (this._check("LPAREN")) {
        expr = this._parseCall(expr);
      }
      return expr;
    }
    if (token.type === "LT") {
      return this._parseReference();
    }
    if (token.type === "LBRACK") {
      return this._parseArray();
    }
    if (token.type === "LBRACE") {
      return this._parseInlineTable();
    }
    if (token.type === "LPAREN") {
      this._advance();
      const inner = this._parseExpr(false);
      this._expect("RPAREN", "Expected ')' to close group");
      return inner;
    }
    if (token.type === "NEWLINE" && stopOnNewline) {
      return null;
    }
    return null;
  }

  _parseCall(callee) {
    const start = callee.range.start;
    this._expect("LPAREN", "Expected '(' after callable");
    const args = [];
    while (!this._check("RPAREN") && !this._check("EOF")) {
      if (this._check("NEWLINE")) {
        this._advance();
        continue;
      }
      const nameToken = this._parseKeyToken();
      if (nameToken === null) {
        this._error("Expected named argument", this._current().range, "expected-named-argument");
        this._syncUntil(new Set(["COMMA", "RPAREN"]));
        if (this._match("COMMA")) {
          continue;
        }
        break;
      }
      if (!this._match("EQ")) {
        this._error("Expected '=' after argument name", this._current().range, "expected-argument-equals");
        this._syncUntil(new Set(["COMMA", "RPAREN"]));
        if (this._match("COMMA")) {
          continue;
        }
        break;
      }
      const value = this._parseExpr(false, true);
      args.push(new NamedArg(nameToken.value, nameToken.range, value));
      if (this._match("COMMA")) {
        continue;
      }
      if (this._check("RPAREN")) {
        break;
      }
    }
    const end = this._expect("RPAREN", "Expected ')' to close call") || this._previous();
    return new CallExpr(new Range(start, end.range.end), callee, args);
  }

  _parseReference() {
    const start = this._advance();
    const parts = [];
    if (!this._check("IDENT")) {
      this._error("Expected reference root name after '<'", this._current().range, "expected-reference-root");
      this._syncUntil(new Set(["GT", "NEWLINE", "EOF"]));
      const end = this._expect("GT", "Expected '>' to close reference") || this._previous();
      return new RefExpr(new Range(start.range.start, end.range.end), parts);
    }
    const root = this._advance();
    parts.push(new RefSegment("name", root.value, root.range, root.type === "STRING"));
    while (!this._check("GT") && !this._check("EOF")) {
      if (this._match("DOT")) {
        const segment = this._parseRefNameSegment();
        if (segment === null) {
          this._error("Expected path segment in reference", this._current().range, "expected-ref-segment");
          break;
        }
        parts.push(new RefSegment("name", segment.value, segment.range, segment.type === "STRING"));
        continue;
      }
      if (this._check("LBRACK")) {
        parts.push(this._parseRefIndex());
        continue;
      }
      if (this._check("LPAREN")) {
        parts.push(this._parseRefCall());
        continue;
      }
      break;
    }
    const end = this._expect("GT", "Expected '>' to close reference") || this._previous();
    const expr = new RefExpr(new Range(start.range.start, end.range.end), parts);
    this.references.push(
      new ReferenceOccurrence(
        expr,
        expr.range,
        [...this.currentTable],
        null,
        null,
        this.currentTableSegments.slice(),
        this.currentTableIdentityKey,
        this.currentValuePathSegments.slice(),
      ),
    );
    return expr;
  }

  _parseRefNameSegment() {
    if (this._check("IDENT") || this._check("STRING")) {
      return this._advance();
    }
    return null;
  }

  _parseRefIndex() {
    const start = this._advance();
    const value = this._parseExpr(false);
    const end = this._expect("RBRACK", "Expected ']' to close index") || this._previous();
    return new RefSegment("index", value, new Range(start.range.start, end.range.end));
  }

  _parseRefCall() {
    const start = this._advance();
    const args = [];
    while (!this._check("RPAREN") && !this._check("EOF")) {
      if (this._check("NEWLINE")) {
        this._advance();
        continue;
      }
      const nameToken = this._parseKeyToken();
      if (nameToken === null) {
        this._error("Expected named filter argument", this._current().range, "expected-filter-argument");
        this._syncUntil(new Set(["COMMA", "RPAREN"]));
        if (this._match("COMMA")) {
          continue;
        }
        break;
      }
      if (!this._match("EQ")) {
        this._error("Expected '=' after filter argument name", this._current().range, "expected-filter-equals");
        this._syncUntil(new Set(["COMMA", "RPAREN"]));
        if (this._match("COMMA")) {
          continue;
        }
        break;
      }
      const value = this._parseExpr(false, true);
      args.push(new NamedArg(nameToken.value, nameToken.range, value));
      if (this._match("COMMA")) {
        continue;
      }
      if (this._check("RPAREN")) {
        break;
      }
    }
    const end = this._expect("RPAREN", "Expected ')' to close reference filter") || this._previous();
    return new RefSegment("call", args, new Range(start.range.start, end.range.end));
  }

  _parseArray() {
    const start = this._advance();
    const items = [];
    while (!this._check("RBRACK") && !this._check("EOF")) {
      if (this._check("NEWLINE")) {
        this._advance();
        continue;
      }
      const item = this._parseExpr(false, true, true);
      items.push(item);
      if (this._match("COMMA")) {
        while (this._check("NEWLINE")) {
          this._advance();
        }
        continue;
      }
      if (this._check("NEWLINE")) {
        while (this._check("NEWLINE")) {
          this._advance();
        }
        continue;
      }
      if (this._check("RBRACK")) {
        break;
      }
      this._error("Expected ',' or ']' in array", this._current().range, "expected-array-separator");
      this._syncUntil(new Set(["COMMA", "RBRACK"]));
      this._match("COMMA");
    }
    const end = this._expect("RBRACK", "Expected ']' to close array") || this._previous();
    return new ArrayExpr(new Range(start.range.start, end.range.end), items);
  }

  _parseInlineTable() {
    const start = this._advance();
    const items = [];
    while (!this._check("RBRACE") && !this._check("EOF")) {
      if (this._check("NEWLINE")) {
        this._advance();
        continue;
      }
      const keyToken = this._parseKeyToken();
      if (keyToken === null) {
        this._error("Expected inline table key", this._current().range, "expected-inline-key");
        this._syncUntil(new Set(["COMMA", "RBRACE"]));
        if (this._match("COMMA")) {
          continue;
        }
        break;
      }
      if (!(this._match("EQ") || this._match("COLON"))) {
        this._error("Expected '=' or ':' after inline table key", this._current().range, "expected-inline-equals");
        this._syncUntil(new Set(["COMMA", "RBRACE"]));
        if (this._match("COMMA")) {
          continue;
        }
        break;
      }
      const value = this._withValuePathSegment(
        {
          value: keyToken.value,
          quoted: keyToken.type === "STRING",
          range: keyToken.range,
        },
        () => this._parseExpr(false, true, true),
      );
      items.push(new InlineEntry(keyToken.value, keyToken.range, value, keyToken.type === "STRING"));
      if (this._match("COMMA")) {
        while (this._check("NEWLINE")) {
          this._advance();
        }
        continue;
      }
      if (this._check("NEWLINE")) {
        while (this._check("NEWLINE")) {
          this._advance();
        }
        continue;
      }
      if (this._check("RBRACE")) {
        break;
      }
      this._error("Expected ',' or '}' in inline table", this._current().range, "expected-inline-separator");
      this._syncUntil(new Set(["COMMA", "RBRACE"]));
      this._match("COMMA");
    }
    const end = this._expect("RBRACE", "Expected '}' to close inline table") || this._previous();
    return new InlineTableExpr(new Range(start.range.start, end.range.end), items);
  }

  _expect(tokenType, message) {
    if (this._check(tokenType)) {
      return this._advance();
    }
    this._error(message, this._current().range, `expected-${tokenType.toLowerCase()}`);
    return null;
  }

  _error(message, range, code = null) {
    this.diagnostics.push(new Diagnostic(message, range, "error", "msra", code));
  }

  _syncToNextStatement() {
    while (!this._check("EOF") && !this._check("NEWLINE")) {
      this._advance();
    }
    this._match("NEWLINE");
  }

  _syncUntil(tokenTypes) {
    while (!this._check("EOF") && !tokenTypes.has(this._current().type)) {
      this._advance();
    }
  }

  _withValuePathSegment(segment, fn) {
    this.currentValuePathSegments.push(segment);
    try {
      return fn();
    } finally {
      this.currentValuePathSegments.pop();
    }
  }
}

function parseDocument(text, uri = "") {
  const tokenizer = new Tokenizer(text);
  const [tokens, diagnostics, lineStarts] = tokenizer.tokenize();
  const state = {
    text,
    uri,
    lineStarts,
    tokens,
    diagnostics: [...diagnostics],
  };
  const parser = new Parser(state);
  return parser.parse();
}

module.exports = {
  ATOM_STARTS,
  Parser,
  Tokenizer,
  parseDocument,
};
