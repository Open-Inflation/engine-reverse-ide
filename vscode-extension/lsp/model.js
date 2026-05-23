class Position {
  constructor(line, character) {
    this.line = line;
    this.character = character;
  }
}

class Range {
  constructor(start, end) {
    this.start = start;
    this.end = end;
  }
}

class Diagnostic {
  constructor(message, range, severity = "error", source = "msra", code = null) {
    this.message = message;
    this.range = range;
    this.severity = severity;
    this.source = source;
    this.code = code;
  }
}

class Token {
  constructor(type, value, range) {
    this.type = type;
    this.value = value;
    this.range = range;
  }
}

class Expr {
  constructor(range) {
    this.range = range;
  }
}

class StringExpr extends Expr {
  constructor(range, value, raw, quoted = true) {
    super(range);
    this.value = value;
    this.raw = raw;
    this.quoted = quoted;
  }
}

class NumberExpr extends Expr {
  constructor(range, value, raw) {
    super(range);
    this.value = value;
    this.raw = raw;
  }
}

class BoolExpr extends Expr {
  constructor(range, value) {
    super(range);
    this.value = value;
  }
}

class NullExpr extends Expr {}

class IdentExpr extends Expr {
  constructor(range, name) {
    super(range);
    this.name = name;
  }
}

class NamedArg {
  constructor(name, nameRange, value) {
    this.name = name;
    this.nameRange = nameRange;
    this.value = value;
  }
}

class CallExpr extends Expr {
  constructor(range, callee, args = []) {
    super(range);
    this.callee = callee;
    this.args = args;
  }
}

class IndexExpr extends Expr {
  constructor(range, value) {
    super(range);
    this.value = value;
  }
}

class RefSegment {
  constructor(kind, value, range, quoted = false) {
    this.kind = kind;
    this.value = value;
    this.range = range;
    this.quoted = quoted;
  }
}

class RefExpr extends Expr {
  constructor(range, parts = []) {
    super(range);
    this.parts = parts;
  }
}

class SequenceExpr extends Expr {
  constructor(range, items = []) {
    super(range);
    this.items = items;
  }
}

class MergeExpr extends Expr {
  constructor(range, parts = []) {
    super(range);
    this.parts = parts;
  }
}

class ArrayExpr extends Expr {
  constructor(range, items = []) {
    super(range);
    this.items = items;
  }
}

class InlineEntry {
  constructor(key, keyRange, value, quoted = false) {
    this.key = key;
    this.keyRange = keyRange;
    this.value = value;
    this.quoted = quoted;
  }
}

class InlineTableExpr extends Expr {
  constructor(range, items = []) {
    super(range);
    this.items = items;
  }
}

class TableDef {
  constructor(path, headerRange, pathSegments = [], identityKey = null) {
    this.path = path;
    this.headerRange = headerRange;
    this.pathSegments = pathSegments;
    this.identityKey = identityKey;
    this.assignments = [];
  }
}

class AssignmentDef {
  constructor(
    tablePath,
    key,
    keyRange,
    value,
    valueRange,
    fullPath,
    quoted = false,
    tablePathSegments = [],
    tableIdentityKey = null,
    identityKey = null,
  ) {
    this.tablePath = tablePath;
    this.key = key;
    this.keyRange = keyRange;
    this.value = value;
    this.valueRange = valueRange;
    this.fullPath = fullPath;
    this.quoted = quoted;
    this.tablePathSegments = tablePathSegments;
    this.tableIdentityKey = tableIdentityKey;
    this.identityKey = identityKey;
  }
}

class ReferenceOccurrence {
  constructor(
    expr,
    range,
    tablePath,
    resolvedPath = null,
    resolvedKind = null,
    tablePathSegments = [],
    tableIdentityKey = null,
  ) {
    this.expr = expr;
    this.range = range;
    this.tablePath = tablePath;
    this.resolvedPath = resolvedPath;
    this.resolvedKind = resolvedKind;
    this.tablePathSegments = tablePathSegments;
    this.tableIdentityKey = tableIdentityKey;
    this.resolvedPathSegments = null;
    this.resolvedPathKey = null;
  }
}

class ParsedDocument {
  constructor({
    uri,
    text,
    lineStarts,
    tokens,
    diagnostics,
    tables,
    assignments,
    references,
    errors,
  }) {
    this.uri = uri;
    this.text = text;
    this.lineStarts = lineStarts;
    this.tokens = tokens;
    this.diagnostics = diagnostics;
    this.tables = tables;
    this.assignments = assignments;
    this.references = references;
    this.errors = errors;
  }

  positionAt(offset) {
    if (offset <= 0) {
      return new Position(0, 0);
    }
    if (offset >= this.text.length) {
      if (!this.lineStarts.length) {
        return new Position(0, offset);
      }
      const line = this.lineStarts.length - 1;
      return new Position(line, Math.max(0, this.text.length - this.lineStarts[this.lineStarts.length - 1]));
    }
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const start = this.lineStarts[mid];
      const nextStart = mid + 1 < this.lineStarts.length ? this.lineStarts[mid + 1] : this.text.length + 1;
      if (start <= offset && offset < nextStart) {
        return new Position(mid, offset - start);
      }
      if (offset < start) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return new Position(0, offset);
  }

  rangeFromOffsets(start, end) {
    return new Range(this.positionAt(start), this.positionAt(end));
  }

  offsetAt(position) {
    if (position.line <= 0) {
      return Math.max(0, position.character);
    }
    if (position.line >= this.lineStarts.length) {
      return this.text.length;
    }
    return Math.min(this.text.length, this.lineStarts[position.line] + Math.max(0, position.character));
  }
}

function pathKey(path) {
  return JSON.stringify((path || []).map((segment) => segmentValue(segment)));
}

function pathLabel(path) {
  return (path || [])
    .map((segment) => {
      if (segment && typeof segment === "object" && Object.prototype.hasOwnProperty.call(segment, "value")) {
        return segment.quoted ? JSON.stringify(segment.value) : String(segment.value);
      }
      return String(segment);
    })
    .join(".");
}

function comparePaths(left, right) {
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    if (index >= left.length) {
      return -1;
    }
    if (index >= right.length) {
      return 1;
    }
    const comparison = String(segmentValue(left[index])).localeCompare(String(segmentValue(right[index])));
    if (comparison !== 0) {
      return comparison;
    }
  }
  return 0;
}

function segmentValue(segment) {
  if (segment && typeof segment === "object" && Object.prototype.hasOwnProperty.call(segment, "value")) {
    return segment.value;
  }
  return segment;
}

module.exports = {
  ArrayExpr,
  AssignmentDef,
  BoolExpr,
  CallExpr,
  Diagnostic,
  Expr,
  IdentExpr,
  InlineEntry,
  InlineTableExpr,
  IndexExpr,
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
  comparePaths,
  pathKey,
  pathLabel,
};
