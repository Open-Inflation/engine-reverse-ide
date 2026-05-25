const {
  Diagnostic,
  comparePaths,
  pathLabel,
} = require("./model");
const { validateAssignmentRelations } = require("./assignment-relations");
const { validateAssignment } = require("./assignment-schema");
const { validateGroupAssignments } = require("./group-relations");
const { validateTableRelations } = require("./table-relations");
const { validateTablePath } = require("./path-schema");
const { pathIdentityKey, normalizePathSegments } = require("./path-schema");
const { parseFuncResultReference } = require("./reference-context");

const KNOWN_DYNAMIC_ROOTS = new Set([
  "UNSTANDARD_HEADERS",
  "CAPTURED_URLS",
  "COOKIES",
  "LOCAL_STORAGE",
  "SESSION_STORAGE",
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

function analyzeDocument(document, context = {}) {
  const diagnostics = [...document.diagnostics];
  diagnostics.push(...validateMsrafStructure(context.rawDocument || null, context.sourcePath || document.uri || ""));
  const localTableIndex = new Map(document.tables);
  const localAssignmentIndex = new Map(document.assignments);
  const lookupTableIndex = context.tableIndex ? new Map([...context.tableIndex, ...localTableIndex]) : localTableIndex;
  const lookupAssignmentIndex = context.assignmentIndex ? new Map([...context.assignmentIndex, ...localAssignmentIndex]) : localAssignmentIndex;
  const rootTableIndex = new Map();
  for (const table of localTableIndex.values()) {
    const tablePath = table.pathSegments || table.path;
    if (!tablePath || !tablePath.length) {
      continue;
    }
    const validation = validateTablePath(tablePath);
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
  for (const table of lookupTableIndex.values()) {
    const tablePath = table.pathSegments || table.path;
    if (tablePath && tablePath.length) {
      rootTableIndex.set(pathLabel(tablePath), table.path);
    }
  }
  diagnostics.push(...validateTableRelations(localTableIndex, lookupTableIndex));
  for (const assignment of localAssignmentIndex.values()) {
    const table = localTableIndex.get(pathIdentityKey(assignment.tablePath));
    for (const diagnostic of validateAssignment(assignment.tablePath, assignment, table ? table.assignments || [] : [])) {
      diagnostics.push(diagnostic);
    }
  }
  diagnostics.push(...validateAssignmentRelations(localTableIndex, localAssignmentIndex, lookupTableIndex, lookupAssignmentIndex));
  diagnostics.push(...validateGroupAssignments(lookupTableIndex, localAssignmentIndex));
  const result = new AnalysisResult(document);
  result.diagnostics = diagnostics;
  result.tableIndex = lookupTableIndex;
  result.assignmentIndex = lookupAssignmentIndex;
  result.rootTableIndex = rootTableIndex;

  for (const ref of document.references) {
    const funcResultReference = parseFuncResultReference(ref.expr, ref.tablePath || [], ref.valuePathSegments || []);
    if (funcResultReference !== null) {
      if (!funcResultReference.valid) {
        diagnostics.push(
          new Diagnostic(
            funcResultReference.message,
            funcResultReference.range || ref.range,
            "error",
            "msra",
            funcResultReference.code,
          ),
        );
        continue;
      }
      const resolved = resolveFuncResultReference(funcResultReference, result);
      if (resolved !== null) {
        ref.resolvedPath = resolved.path;
        ref.resolvedPathSegments = resolved.pathSegments;
        ref.resolvedPathKey = resolved.key;
        ref.resolvedKind = resolved.kind;
        continue;
      }
      diagnostics.push(
        new Diagnostic(
          `Unresolved reference <${renderRef(ref.expr)}>`,
          ref.range,
          "error",
          "msra",
          "unresolved-reference",
        ),
      );
      continue;
    }
    const resolved = resolveReference(ref, result);
    ref.resolvedPath = resolved ? resolved.path : null;
    ref.resolvedPathSegments = resolved ? resolved.pathSegments : null;
    ref.resolvedPathKey = resolved ? resolved.key : null;
    ref.resolvedKind = resolved ? resolved.kind : null;
    if (resolved === null && ref.expr.parts.length) {
      const root = ref.expr.parts[0].value;
      if (!KNOWN_DYNAMIC_ROOTS.has(root)) {
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

function validateMsrafStructure(rawDocument, sourcePath) {
  if (!rawDocument || !String(sourcePath || "").toLowerCase().endsWith(".msraf")) {
    return [];
  }
  const diagnostics = [];
  for (const table of rawDocument.tables.values()) {
    const segments = table.pathSegments || table.path || [];
    const prefixIndex = findAppFuncPrefixIndex(segments);
    if (prefixIndex === -1) {
      continue;
    }
    diagnostics.push(
      new Diagnostic(
        'In .msraf files, omit the leading "app.func" namespace and write relative function tables instead.',
        segments[prefixIndex] && segments[prefixIndex].range ? segments[prefixIndex].range : table.headerRange,
        "error",
        "msra",
        "invalid-msraf-table-path",
      ),
    );
  }
  return diagnostics;
}

function findAppFuncPrefixIndex(segments) {
  for (let index = 0; index < segments.length - 1; index += 1) {
    const current = segments[index];
    const next = segments[index + 1];
    if (
      current &&
      current.value === "app" &&
      !current.quoted &&
      next &&
      next.value === "func" &&
      !next.quoted
    ) {
      return index;
    }
  }
  return -1;
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
  const root = path[0] && path[0].value;
  if (KNOWN_DYNAMIC_ROOTS.has(root)) {
    return {
      path: path.map((segment) => String(segment && segment.value !== undefined ? segment.value : segment)),
      pathSegments: path,
      key: pathIdentityKey(path),
      kind: "dynamic-root",
    };
  }
  return null;
}

function resolveFuncResultReference(funcResultReference, result) {
  const functionPath = [makePathSegment("app"), makePathSegment("func"), makePathSegment(funcResultReference.functionId)];
  const resolved = resolveStaticPath(functionPath, result);
  if (resolved === null) {
    return null;
  }
  return {
    path: resolved.path,
    pathSegments: resolved.pathSegments,
    key: resolved.key,
    kind: `func-result-${String(funcResultReference.resultKind || "").toLowerCase()}`,
  };
}

function refPathSegments(ref) {
  const path = [];
  for (const part of ref.parts) {
    if (part.kind !== "name") {
      break;
    }
    path.push({
      value: String(part.value),
      quoted: Boolean(part.quoted),
      range: part.range || null,
    });
  }
  return path;
}

function expandVirtualPath(path, currentTable) {
  if (!path.length) {
    return null;
  }
  const root = path[0] && path[0].value;
  if (root === "DOCUMENT") {
    if (path.length >= 2 && path[1] && path[1].value === "PREFIXES") {
      return [makePathSegment("app"), makePathSegment("prefixes"), ...path.slice(2)];
    }
    if (path.length >= 2 && path[1] && path[1].value === "REGEXES") {
      return [makePathSegment("app"), makePathSegment("regexes"), ...path.slice(2)];
    }
    if (path.length >= 2 && path[1] && path[1].value === "WARMUP") {
      return [makePathSegment("app"), makePathSegment("warmup"), ...path.slice(2)];
    }
  }
  if (root === "VARIABLES") {
    return [makePathSegment("app"), makePathSegment("variables"), ...path.slice(1)];
  }
  if (root === "GROUPS") {
    return [makePathSegment("app"), makePathSegment("groups"), ...path.slice(1)];
  }
  if (root === "INPUT") {
    const functionId = currentFunctionId(currentTable);
    if (functionId) {
      return [
        makePathSegment("app"),
        makePathSegment("func"),
        makePathSegment(functionId),
        makePathSegment("input"),
        ...path.slice(1),
      ];
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
  if (path.length > 1) {
    const prefix = path.slice(0, -1);
    const prefixKey = pathIdentityKey(prefix);
    if (result.tableIndex.has(prefixKey)) {
      const last = path[path.length - 1];
      const candidateKey = assignmentIdentityKey(prefixKey, last && last.value);
      if (result.assignmentIndex.has(candidateKey)) {
        const assignment = result.assignmentIndex.get(candidateKey);
        return buildResolvedAssignment(prefix, last, assignment, candidateKey);
      }
    }
  }
  const key = pathIdentityKey(path);
  if (result.tableIndex.has(key)) {
    const table = result.tableIndex.get(key);
    return buildResolvedTable(table, key);
  }
  return null;
}

function collectDefinitionLocations(result) {
  const locations = new Map();
  for (const [key, table] of result.tableIndex.entries()) {
    locations.set(key, {
      sourcePath: table.sourcePath || null,
      range: table.headerRange,
    });
  }
  for (const [key, assignment] of result.assignmentIndex.entries()) {
    locations.set(key, {
      sourcePath: assignment.sourcePath || null,
      range: assignment.keyRange,
    });
  }
  return locations;
}

function tableChildren(result, tablePath) {
  const children = [];
  const parentSegments = normalizePathSegments(tablePath);
  const parentKey = pathIdentityKey(parentSegments);
  for (const table of result.tableIndex.values()) {
    const childSegments = table.pathSegments || normalizePathSegments(table.path);
    if (childSegments.length === parentSegments.length + 1 && pathIdentityKey(childSegments.slice(0, parentSegments.length)) === parentKey) {
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

function makePathSegment(value, quoted = false) {
  return {
    value: String(value),
    quoted: Boolean(quoted),
    range: null,
  };
}

function assignmentIdentityKey(tableKey, key) {
  return JSON.stringify([tableKey, String(key)]);
}

function buildResolvedTable(table, key) {
  const pathSegments = table.pathSegments || normalizePathSegments(table.path);
  return {
    path: table.path,
    pathSegments,
    key,
    kind: "table",
  };
}

function buildResolvedAssignment(prefix, last, assignment, key) {
  const pathSegments = [...prefix, {
    value: String(last && last.value !== undefined ? last.value : ""),
    quoted: Boolean(last && last.quoted),
    range: last && last.range ? last.range : null,
  }];
  return {
    path: assignment.fullPath,
    pathSegments,
    key,
    kind: "assignment",
  };
}
