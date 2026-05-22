const {
  Diagnostic,
  comparePaths,
  pathKey,
  pathLabel,
} = require("./model");
const { validateTablePath } = require("./path-schema");

const KNOWN_DYNAMIC_ROOTS = new Set([
  "UNSTANDART_HEADERS",
  "CAPTURED_URLS",
  "COOKIES",
  "LOCAL_STORAGE",
  "SESSION_STORAGE",
]);

const VIRTUAL_ROOTS = new Set([
  "DOCUMENT",
  "VARIABLES",
  "INPUT",
]);

class AnalysisResult {
  constructor(document) {
    this.document = document;
    this.diagnostics = [];
    this.tableIndex = new Map();
    this.assignmentIndex = new Map();
    this.rootTableIndex = new Map();
  }
}

function analyzeDocument(document) {
  const diagnostics = [...document.diagnostics];
  const tableIndex = new Map(document.tables);
  const assignmentIndex = new Map(document.assignments);
  const rootTableIndex = new Map();
  for (const table of tableIndex.values()) {
    if (table.path.length) {
      rootTableIndex.set(pathLabel(table.path), table.path);
      const validation = validateTablePath(table.pathSegments || table.path);
      if (!validation.valid) {
        diagnostics.push(
          new Diagnostic(
            validation.message,
            tablePathSegmentRange(table, validation.segmentIndex),
            "error",
            "msra",
            validation.code,
          ),
        );
      }
    }
  }
  const result = new AnalysisResult(document);
  result.diagnostics = diagnostics;
  result.tableIndex = tableIndex;
  result.assignmentIndex = assignmentIndex;
  result.rootTableIndex = rootTableIndex;

  for (const ref of document.references) {
    const resolved = resolveReference(ref, result);
    ref.resolvedPath = resolved ? resolved[0] : null;
    ref.resolvedKind = resolved ? resolved[1] : null;
    if (resolved === null && ref.expr.parts.length) {
      const root = ref.expr.parts[0].value;
      if (!KNOWN_DYNAMIC_ROOTS.has(root) && !VIRTUAL_ROOTS.has(root)) {
        diagnostics.push(
          new Diagnostic(
            `Unresolved reference <${renderRef(ref.expr)}>`,
            ref.range,
            "error",
            "msra",
            "unresolved-reference",
          ),
        );
      }
    }
  }

  return result;
}

function tablePathSegmentRange(table, segmentIndex) {
  if (table.pathSegments && table.pathSegments[segmentIndex] && table.pathSegments[segmentIndex].range) {
    return table.pathSegments[segmentIndex].range;
  }
  return table.headerRange;
}

function renderRef(ref) {
  const rendered = [];
  for (const part of ref.parts) {
    if (part.kind === "name") {
      if (rendered.length) {
        rendered.push(".");
      }
      rendered.push(String(part.value));
    } else if (part.kind === "index") {
      rendered.push("[...]");
    } else if (part.kind === "call") {
      rendered.push("(...)");
    }
  }
  return rendered.join("");
}

function resolveReference(ref, result) {
  const path = refPathSegments(ref.expr);
  if (!path.length) {
    return null;
  }
  const tablePath = ref.tablePath;
  const expanded = expandVirtualPath(path, tablePath);
  if (expanded !== null) {
    const resolved = resolveStaticPath(expanded, result);
    if (resolved !== null) {
      return resolved;
    }
  }
  const resolved = resolveStaticPath(path, result);
  if (resolved !== null) {
    return resolved;
  }
  const root = path[0];
  if (KNOWN_DYNAMIC_ROOTS.has(root)) {
    return [path, "dynamic-root"];
  }
  return null;
}

function refPathSegments(ref) {
  const path = [];
  for (const part of ref.parts) {
    if (part.kind !== "name") {
      break;
    }
    path.push(String(part.value));
  }
  return path;
}

function expandVirtualPath(path, currentTable) {
  if (!path.length) {
    return null;
  }
  const root = path[0];
  if (root === "DOCUMENT") {
    if (path.length >= 2 && path[1] === "PREFIXES") {
      return ["app", "prefixes", ...path.slice(2)];
    }
    if (path.length >= 2 && (path[1] === "REGEX" || path[1] === "REGEXES")) {
      return ["app", "regexes", ...path.slice(2)];
    }
    if (path.length >= 2 && path[1] === "WARMUP") {
      return ["app", "warmup", ...path.slice(2)];
    }
  }
  if (root === "VARIABLES") {
    return ["app", "variables", ...path.slice(1)];
  }
  if (root === "INPUT") {
    const functionId = currentFunctionId(currentTable);
    if (functionId) {
      return ["app", "func", functionId, "input", ...path.slice(1)];
    }
  }
  return null;
}

function currentFunctionId(tablePath) {
  const segments = [...tablePath];
  for (let index = 0; index < segments.length - 2; index += 1) {
    if (segments[index] === "app" && segments[index + 1] === "func") {
      return segments[index + 2];
    }
  }
  return null;
}

function resolveStaticPath(path, result) {
  const key = pathKey(path);
  if (result.assignmentIndex.has(key)) {
    return [path, "assignment"];
  }
  if (result.tableIndex.has(key)) {
    return [path, "table"];
  }
  if (!path.length) {
    return null;
  }
  if (path.length > 1) {
    for (let index = path.length - 1; index > 0; index -= 1) {
      const prefix = path.slice(0, index);
      const suffix = path.slice(index);
      if (result.tableIndex.has(pathKey(prefix)) && suffix.length === 1) {
        const candidate = prefix.concat(suffix);
        if (result.assignmentIndex.has(pathKey(candidate))) {
          return [candidate, "assignment"];
        }
      }
    }
  }
  return null;
}

function collectDefinitionLocations(result) {
  const locations = new Map();
  for (const [key, table] of result.tableIndex.entries()) {
    locations.set(key, table.headerRange);
  }
  for (const [key, assignment] of result.assignmentIndex.entries()) {
    locations.set(key, assignment.keyRange);
  }
  return locations;
}

function tableChildren(result, tablePath) {
  const children = [];
  for (const table of result.tableIndex.values()) {
    if (table.path.length === tablePath.length + 1 && table.path.slice(0, tablePath.length).every((segment, index) => segment === tablePath[index])) {
      children.push(table.path);
    }
  }
  return children.sort(comparePaths);
}

function* iterAllPaths(result) {
  const tablePaths = [...result.tableIndex.values()].map((table) => table.path).sort(comparePaths);
  const assignmentPaths = [...result.assignmentIndex.values()].map((assignment) => assignment.fullPath).sort(comparePaths);
  yield* tablePaths;
  yield* assignmentPaths;
}

module.exports = {
  AnalysisResult,
  KNOWN_DYNAMIC_ROOTS,
  VIRTUAL_ROOTS,
  analyzeDocument,
  collectDefinitionLocations,
  currentFunctionId,
  expandVirtualPath,
  iterAllPaths,
  refPathSegments,
  renderRef,
  resolveReference,
  tableChildren,
};
