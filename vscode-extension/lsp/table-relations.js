const { Diagnostic, pathKey } = require("./model");
const { renderPath } = require("./path-schema");

function validateTableRelations(tableIndex) {
  const diagnostics = [];
  for (const table of tableIndex.values()) {
    diagnostics.push(...validateTableRelationsForTable(table, tableIndex));
  }
  return diagnostics;
}

function validateTableRelationsForTable(table, tableIndex) {
  const path = table.path || [];
  if (path.length <= 1) {
    return [];
  }

  const diagnostics = [];
  if (path[0] === "app" && !hasTable(tableIndex, ["app"])) {
    diagnostics.push(missingParentDiagnostic(table, ["app"], 0));
    return diagnostics;
  }

  if (path[0] !== "app") {
    return diagnostics;
  }

  if (path[1] === "groups") {
    if (path.length > 3) {
      const parentPath = path.slice(0, path.length - 1);
      if (!hasTable(tableIndex, parentPath)) {
        diagnostics.push(missingParentDiagnostic(table, parentPath, path.length - 2));
      }
    }
    return diagnostics;
  }

  if (path[1] !== "func") {
    return diagnostics;
  }

  if (path.length > 3 && !hasTable(tableIndex, path.slice(0, 3))) {
    diagnostics.push(missingParentDiagnostic(table, path.slice(0, 3), 2));
    return diagnostics;
  }

  if (path[3] === "body") {
    if (path.length > 4 && !hasTable(tableIndex, path.slice(0, 4))) {
      diagnostics.push(missingParentDiagnostic(table, path.slice(0, 4), 3));
      return diagnostics;
    }
    if (path.length > 5) {
      const parentPath = path.slice(0, path.length - 1);
      if (!hasTable(tableIndex, parentPath)) {
        diagnostics.push(missingParentDiagnostic(table, parentPath, path.length - 2));
      }
    }
    return diagnostics;
  }

  if (path[3] === "url") {
    if (path.length > 4 && !hasTable(tableIndex, path.slice(0, 4))) {
      diagnostics.push(missingParentDiagnostic(table, path.slice(0, 4), 3));
      return diagnostics;
    }
    for (let index = 6; index < path.length; index += 1) {
      if (path[index] === "params") {
        const parentPath = path.slice(0, index);
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
  return tableIndex.has(pathKey(path));
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
