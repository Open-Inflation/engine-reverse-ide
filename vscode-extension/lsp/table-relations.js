const { Diagnostic } = require("./model");
const { normalizePathSegments, pathIdentityKey, renderPath } = require("./path-schema");

function validateTableRelations(tableIndex, lookupTableIndex = tableIndex) {
  const diagnostics = [];
  for (const table of tableIndex.values()) {
    diagnostics.push(...validateTableRelationsForTable(table, lookupTableIndex));
  }
  return diagnostics;
}

function validateTableRelationsForTable(table, tableIndex) {
  const segments = table.pathSegments || normalizePathSegments(table.path);
  if (segments.length <= 1) {
    return [];
  }

  const diagnostics = [];
  if (segments[0].value === "app" && !segments[0].quoted && !hasTable(tableIndex, segments.slice(0, 1))) {
    diagnostics.push(missingParentDiagnostic(table, segments.slice(0, 1), 0));
    return diagnostics;
  }

  if (segments[0].value !== "app" || segments[0].quoted) {
    return diagnostics;
  }

  if (segments[1].value === "groups" && !segments[1].quoted) {
    if (segments.length > 3) {
      const parentPath = segments.slice(0, segments.length - 1);
      if (!hasTable(tableIndex, parentPath)) {
        diagnostics.push(missingParentDiagnostic(table, parentPath, segments.length - 2));
      }
    }
    return diagnostics;
  }

  if (segments[1].value !== "func" || segments[1].quoted) {
    return diagnostics;
  }

  if (segments.length > 3 && !hasTable(tableIndex, segments.slice(0, 3))) {
    diagnostics.push(missingParentDiagnostic(table, segments.slice(0, 3), 2));
    return diagnostics;
  }

  if (segments[3] && segments[3].value === "body" && !segments[3].quoted) {
    if (segments.length > 4 && !hasTable(tableIndex, segments.slice(0, 4))) {
      diagnostics.push(missingParentDiagnostic(table, segments.slice(0, 4), 3));
      return diagnostics;
    }
    if (segments.length > 5) {
      const parentPath = segments.slice(0, segments.length - 1);
      if (!hasTable(tableIndex, parentPath)) {
        diagnostics.push(missingParentDiagnostic(table, parentPath, segments.length - 2));
      }
    }
    return diagnostics;
  }

  if (segments[3] && segments[3].value === "url" && !segments[3].quoted) {
    if (segments.length > 4 && !hasTable(tableIndex, segments.slice(0, 4))) {
      diagnostics.push(missingParentDiagnostic(table, segments.slice(0, 4), 3));
      return diagnostics;
    }
    for (let index = 6; index < segments.length; index += 1) {
      if (segments[index].value === "params" && !segments[index].quoted) {
        const parentPath = segments.slice(0, index);
        if (!hasTable(tableIndex, parentPath)) {
          diagnostics.push(missingParentDiagnostic(table, parentPath, index - 1));
          return diagnostics;
        }
      }
    }
  }

  return diagnostics;
}

function hasTable(tableIndex, path) {
  return tableIndex.has(pathIdentityKey(path));
}

function missingParentDiagnostic(table, parentPath, segmentIndex) {
  const parentDisplay = table.pathSegments
    ? renderPath(table.pathSegments.slice(0, parentPath.length))
    : renderPath(parentPath);
  return new Diagnostic(
    `Table path "${renderPath(table.pathSegments || table.path)}" requires parent table "${parentDisplay}" to exist.`,
    segmentRange(table, segmentIndex),
    "error",
    "msra",
    "missing-table-parent",
  );
}

function segmentRange(table, segmentIndex) {
  if (table.pathSegments && table.pathSegments[segmentIndex] && table.pathSegments[segmentIndex].range) {
    return table.pathSegments[segmentIndex].range;
  }
  return table.headerRange;
}

module.exports = {
  validateTableRelations,
};
