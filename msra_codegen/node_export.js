#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const {
  ArrayExpr,
  BoolExpr,
  CallExpr,
  InlineEntry,
  InlineTableExpr,
  IdentExpr,
  MergeExpr,
  NamedArg,
  NullExpr,
  NumberExpr,
  RefExpr,
  RefSegment,
  SequenceExpr,
  StringExpr,
} = require(path.resolve(__dirname, "..", "vscode-extension", "lsp", "model"));
const { analyzeDocument } = require(path.resolve(__dirname, "..", "vscode-extension", "lsp", "analysis"));
const { loadProject } = require(path.resolve(__dirname, "..", "vscode-extension", "lsp", "project-loader"));

function serializePosition(position) {
  if (!position) {
    return null;
  }
  return {
    line: position.line,
    character: position.character,
  };
}

function serializeRange(range) {
  if (!range) {
    return null;
  }
  return {
    start: serializePosition(range.start),
    end: serializePosition(range.end),
  };
}

function serializeNamedArg(arg) {
  return {
    name: arg.name,
    nameRange: serializeRange(arg.nameRange),
    value: serializeExpr(arg.value),
  };
}

function serializeRefSegment(segment) {
  if (segment.kind === "name") {
    return {
      kind: segment.kind,
      value: segment.value,
      range: serializeRange(segment.range),
      quoted: Boolean(segment.quoted),
    };
  }
  if (segment.kind === "index") {
    return {
      kind: segment.kind,
      value: serializeExpr(segment.value),
      range: serializeRange(segment.range),
    };
  }
  if (segment.kind === "call") {
    return {
      kind: segment.kind,
      value: segment.value.map(serializeNamedArg),
      range: serializeRange(segment.range),
    };
  }
  return {
    kind: segment.kind,
    value: segment.value,
    range: serializeRange(segment.range),
  };
}

function serializeInlineEntry(entry) {
  return {
    key: entry.key,
    keyRange: serializeRange(entry.keyRange),
    value: serializeExpr(entry.value),
    quoted: Boolean(entry.quoted),
  };
}

function serializeExpr(expr) {
  if (expr === null || expr === undefined) {
    return null;
  }
  if (expr instanceof StringExpr) {
    return {
      kind: "string",
      value: expr.value,
      raw: expr.raw,
      quoted: Boolean(expr.quoted),
      range: serializeRange(expr.range),
    };
  }
  if (expr instanceof NumberExpr) {
    return {
      kind: "number",
      value: expr.value,
      raw: expr.raw,
      range: serializeRange(expr.range),
    };
  }
  if (expr instanceof BoolExpr) {
    return {
      kind: "bool",
      value: expr.value,
      range: serializeRange(expr.range),
    };
  }
  if (expr instanceof NullExpr) {
    return {
      kind: "null",
      range: serializeRange(expr.range),
    };
  }
  if (expr instanceof IdentExpr) {
    return {
      kind: "ident",
      value: expr.name,
      range: serializeRange(expr.range),
    };
  }
  if (expr instanceof RefExpr) {
    return {
      kind: "ref",
      parts: expr.parts.map(serializeRefSegment),
      range: serializeRange(expr.range),
    };
  }
  if (expr instanceof SequenceExpr) {
    return {
      kind: "sequence",
      items: expr.items.map(serializeExpr),
      range: serializeRange(expr.range),
    };
  }
  if (expr instanceof MergeExpr) {
    return {
      kind: "merge",
      parts: expr.parts.map(serializeExpr),
      range: serializeRange(expr.range),
    };
  }
  if (expr instanceof ArrayExpr) {
    return {
      kind: "array",
      items: expr.items.map(serializeExpr),
      range: serializeRange(expr.range),
    };
  }
  if (expr instanceof InlineTableExpr) {
    return {
      kind: "inline_table",
      items: expr.items.map(serializeInlineEntry),
      range: serializeRange(expr.range),
    };
  }
  if (expr instanceof CallExpr) {
    return {
      kind: "call",
      callee: serializeExpr(expr.callee),
      args: expr.args.map(serializeNamedArg),
      range: serializeRange(expr.range),
    };
  }
  if (expr instanceof InlineEntry) {
    return serializeInlineEntry(expr);
  }
  if (expr instanceof RefSegment) {
    return serializeRefSegment(expr);
  }
  if (expr instanceof NamedArg) {
    return serializeNamedArg(expr);
  }
  return {
    kind: "unknown",
    range: serializeRange(expr.range),
  };
}

function serializeTable(table) {
  return {
    path: table.path,
    headerRange: serializeRange(table.headerRange),
    pathSegments: (table.pathSegments || []).map((segment) => ({
      value: segment.value,
      quoted: Boolean(segment.quoted),
      range: serializeRange(segment.range),
    })),
    assignments: (table.assignments || []).map(serializeAssignment),
  };
}

function serializeAssignment(assignment) {
  return {
    tablePath: assignment.tablePath,
    key: assignment.key,
    keyRange: serializeRange(assignment.keyRange),
    value: serializeExpr(assignment.value),
    valueRange: serializeRange(assignment.valueRange),
    fullPath: assignment.fullPath,
    quoted: Boolean(assignment.quoted),
    annotation: Boolean(assignment.annotation),
    annotationName: assignment.annotationName || null,
    annotationHasArguments: Boolean(assignment.annotationHasArguments),
  };
}

function serializeDiagnostic(diagnostic) {
  return {
    message: diagnostic.message,
    severity: diagnostic.severity,
    source: diagnostic.source,
    code: diagnostic.code,
    range: serializeRange(diagnostic.range),
  };
}

function serializeReference(reference) {
  return {
    expr: serializeExpr(reference.expr),
    range: serializeRange(reference.range),
    tablePath: reference.tablePath,
    resolvedPath: reference.resolvedPath,
    resolvedKind: reference.resolvedKind,
    valuePathSegments: reference.valuePathSegments,
  };
}

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node node_export.js <file.msra>");
    process.exit(1);
  }
  const project = loadProject(path.resolve(inputPath));
  const document = {
    uri: project.rootPath,
    text: project.rootDocument ? project.rootDocument.transformed.text : "",
    lineStarts: project.rootDocument ? project.rootDocument.transformed.lineStarts : [],
    diagnostics: project.rootDocument ? project.rootDocument.transformed.diagnostics : [],
    tables: project.mergedTables,
    assignments: project.mergedAssignments,
    references: project.mergedReferences,
    directives: project.mergedDirectives,
    errors: [],
  };
  const analysis = analyzeDocument(document);
  if (analysis.diagnostics.length) {
    console.error(JSON.stringify(analysis.diagnostics.map(serializeDiagnostic), null, 2));
    process.exit(1);
  }

  const tables = [...project.mergedTables.values()].map(serializeTable);
  const assignments = [...project.mergedAssignments.values()].map(serializeAssignment);
  const references = (project.mergedReferences || []).map(serializeReference);

  process.stdout.write(
    JSON.stringify(
      {
        uri: project.rootPath,
        text: document.text,
        lineStarts: document.lineStarts,
        tables,
        assignments,
        references,
        directives: project.mergedDirectives || [],
        rootPath: project.rootPath,
      },
      null,
      2,
    ),
  );
}

main();
