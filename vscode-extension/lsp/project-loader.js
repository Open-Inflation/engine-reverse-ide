const fs = require("fs");
const path = require("path");
const { fileURLToPath } = require("url");

const { parseDocument } = require("./parser");
const { normalizePathSegments, pathIdentityKey } = require("./path-schema");

function toAbsoluteFilePath(input) {
  if (!input) {
    throw new Error("Missing file path");
  }
  if (typeof input !== "string") {
    throw new TypeError("File path must be a string");
  }
  if (input.startsWith("file://")) {
    return path.resolve(fileURLToPath(input));
  }
  return path.resolve(input);
}

function clonePosition(position) {
  if (!position) {
    return null;
  }
  return {
    line: position.line,
    character: position.character,
  };
}

function cloneRange(range) {
  if (!range) {
    return null;
  }
  return {
    start: clonePosition(range.start),
    end: clonePosition(range.end),
  };
}

function cloneSegments(segments, prefix = []) {
  return [...normalizePathSegments(prefix), ...normalizePathSegments(segments)];
}

function pathValues(pathSegments) {
  return normalizePathSegments(pathSegments).map((segment) => segment.value);
}

function cloneTable(table, prefix, sourcePath) {
  const pathSegments = cloneSegments(table.pathSegments || table.path || [], prefix);
  const path = pathSegments.map((segment) => segment.value);
  const assignments = [];
  return {
    ...table,
    sourcePath,
    prefix: [...pathValues(prefix)],
    path,
    pathSegments,
    identityKey: pathIdentityKey(pathSegments),
    assignments,
  };
}

function cloneAssignment(assignment, prefix, sourcePath) {
  const tablePathSegments = cloneSegments(assignment.tablePathSegments || assignment.tablePath || [], prefix);
  const tablePath = tablePathSegments.map((segment) => segment.value);
  const fullPath = [...tablePath, assignment.key];
  const tableIdentityKey = pathIdentityKey(tablePathSegments);
  return {
    ...assignment,
    sourcePath,
    prefix: [...pathValues(prefix)],
    tablePath,
    tablePathSegments,
    tableIdentityKey,
    fullPath,
    identityKey: JSON.stringify([tableIdentityKey, String(assignment.key)]),
  };
}

function cloneReference(reference, prefix, sourcePath) {
  const tablePathSegments = cloneSegments(reference.tablePathSegments || reference.tablePath || [], prefix);
  const tablePath = tablePathSegments.map((segment) => segment.value);
  return {
    ...reference,
    sourcePath,
    prefix: [...pathValues(prefix)],
    tablePath,
    tablePathSegments,
    tableIdentityKey: pathIdentityKey(tablePathSegments),
    resolvedPath: null,
    resolvedPathSegments: null,
    resolvedPathKey: null,
    resolvedKind: null,
  };
}

function cloneDirective(directive, sourcePath) {
  return {
    ...directive,
    sourcePath,
  };
}

function loadParsedDocument(filePath, cache, options = {}) {
  const resolvedPath = toAbsoluteFilePath(filePath);
  if (cache.has(resolvedPath)) {
    return cache.get(resolvedPath);
  }
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`);
  }
  const overrides = options.textOverrides || {};
  const text = Object.prototype.hasOwnProperty.call(overrides, resolvedPath)
    ? String(overrides[resolvedPath])
    : fs.readFileSync(resolvedPath, "utf8");
  const parsed = parseDocument(text, resolvedPath);
  const record = {
    path: resolvedPath,
    text,
    parsed,
  };
  cache.set(resolvedPath, record);
  return record;
}

function resolveRootPath(entryPath, cache, options = {}) {
  const record = loadParsedDocument(entryPath, cache, options);
  const rootDirective = (record.parsed.directives || []).find((directive) => directive.kind === "root");
  if (!rootDirective) {
    return record.path;
  }
  const rootPath = toAbsoluteFilePath(path.resolve(path.dirname(record.path), rootDirective.value));
  if (!fs.existsSync(rootPath)) {
    throw new Error(`Root file not found: ${rootPath}`);
  }
  return rootPath;
}

function loadProject(entryPath, options = {}) {
  const cache = new Map();
  const entryRecord = loadParsedDocument(entryPath, cache, options);
  const rootPath = resolveRootPath(entryRecord.path, cache, options);
  const project = {
    entryPath: entryRecord.path,
    rootPath,
    documents: new Map(),
    documentOrder: [],
    mergedTables: new Map(),
    mergedAssignments: new Map(),
    mergedReferences: [],
    mergedDirectives: [],
  };
  visitProjectDocument(rootPath, [], project, cache, new Set(), options);
  project.rootDocument = project.documents.get(rootPath) || null;
  return project;
}

function visitProjectDocument(filePath, prefix, project, cache, stack, options = {}) {
  const resolvedPath = toAbsoluteFilePath(filePath);
  if (stack.has(resolvedPath)) {
    const chain = [...stack, resolvedPath].join(" -> ");
    throw new Error(`Include cycle detected: ${chain}`);
  }

  const record = loadParsedDocument(resolvedPath, cache, options);
  if (project.documents.has(resolvedPath)) {
    const existing = project.documents.get(resolvedPath);
    const existingPrefix = JSON.stringify(existing.prefix || []);
    const nextPrefix = JSON.stringify(prefix || []);
    if (existingPrefix !== nextPrefix) {
      throw new Error(`File ${resolvedPath} is included more than once with different prefixes.`);
    }
    return existing;
  }

  const transformed = transformParsedDocument(record.parsed, prefix, resolvedPath);
  const document = {
    path: resolvedPath,
    prefix: [...pathValues(prefix)],
    raw: record.parsed,
    transformed,
  };
  project.documents.set(resolvedPath, document);
  project.documentOrder.push(resolvedPath);

  for (const table of transformed.tables.values()) {
    project.mergedTables.set(table.identityKey || pathIdentityKey(table.pathSegments || table.path), table);
  }
  for (const assignment of transformed.assignments.values()) {
    project.mergedAssignments.set(assignment.identityKey || JSON.stringify([assignment.tableIdentityKey || pathIdentityKey(assignment.tablePathSegments || assignment.tablePath), String(assignment.key)]), assignment);
  }
  for (const reference of transformed.references || []) {
    project.mergedReferences.push(reference);
  }
  for (const directive of transformed.directives || []) {
    project.mergedDirectives.push(directive);
  }

  stack.add(resolvedPath);
  for (const directive of record.parsed.directives || []) {
    if (directive.kind !== "include") {
      continue;
    }
    const childPath = toAbsoluteFilePath(path.resolve(path.dirname(resolvedPath), directive.value));
    const childPrefix = [...normalizePathSegments(prefix), ...normalizePathSegments(directive.tablePath || [])];
    visitProjectDocument(childPath, childPrefix, project, cache, stack, options);
  }
  stack.delete(resolvedPath);

  return document;
}

function transformParsedDocument(parsed, prefix, sourcePath) {
  const transformedAssignments = new Map();
  for (const assignment of parsed.assignments.values()) {
    const cloned = cloneAssignment(assignment, prefix, sourcePath);
    transformedAssignments.set(cloned.identityKey, cloned);
  }

  const transformedTables = new Map();
  for (const table of parsed.tables.values()) {
    const cloned = cloneTable(table, prefix, sourcePath);
    cloned.assignments = (table.assignments || []).map((assignment) => {
      const key = assignment.identityKey || JSON.stringify([assignment.tableIdentityKey || pathIdentityKey(assignment.tablePathSegments || assignment.tablePath), String(assignment.key)]);
      return transformedAssignments.get(key) || cloneAssignment(assignment, prefix, sourcePath);
    });
    transformedTables.set(cloned.identityKey, cloned);
  }

  const transformedReferences = (parsed.references || []).map((reference) => cloneReference(reference, prefix, sourcePath));
  const transformedDirectives = (parsed.directives || []).map((directive) => cloneDirective(directive, sourcePath));

  const transformed = Object.create(Object.getPrototypeOf(parsed));
  Object.assign(transformed, {
    uri: parsed.uri,
    text: parsed.text,
    lineStarts: parsed.lineStarts,
    tokens: parsed.tokens,
    diagnostics: parsed.diagnostics,
    tables: transformedTables,
    assignments: transformedAssignments,
    references: transformedReferences,
    directives: transformedDirectives,
    errors: parsed.errors,
    sourcePath,
    prefix: [...pathValues(prefix)],
  });
  return transformed;
}

function buildMergedProject(entryPath, options = {}) {
  const project = loadProject(entryPath, options);
  return {
    ...project,
    tables: [...project.mergedTables.values()],
    assignments: [...project.mergedAssignments.values()],
    references: [...project.mergedReferences],
    directives: [...project.mergedDirectives],
  };
}

module.exports = {
  buildMergedProject,
  loadProject,
  resolveRootPath,
  toAbsoluteFilePath,
  transformParsedDocument,
  visitProjectDocument,
};
