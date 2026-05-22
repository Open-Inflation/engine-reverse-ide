const {
  ArrayExpr,
  BoolExpr,
  Diagnostic,
  InlineTableExpr,
  NumberExpr,
  StringExpr,
  pathKey,
  pathLabel,
} = require("./model");

function validateAssignmentRelations(tableIndex, assignmentIndex) {
  const diagnostics = [];
  const assignmentsByTable = collectAssignmentsByTable(assignmentIndex);

  diagnostics.push(...validateValuesRevalueConflicts(assignmentsByTable));
  diagnostics.push(...validateFuncTransportRelations(assignmentsByTable));
  diagnostics.push(...validateFuncPostprocessRelations(tableIndex, assignmentIndex));
  diagnostics.push(...validateWarmupRelations(assignmentIndex));
  diagnostics.push(...validateBodyRelations(tableIndex, assignmentIndex));
  diagnostics.push(...validateUrlParamValueRelations(assignmentsByTable));

  return diagnostics;
}

function collectAssignmentsByTable(assignmentIndex) {
  const assignmentsByTable = new Map();
  for (const assignment of assignmentIndex.values()) {
    const key = pathKey(assignment.tablePath);
    if (!assignmentsByTable.has(key)) {
      assignmentsByTable.set(key, []);
    }
    assignmentsByTable.get(key).push(assignment);
  }
  return assignmentsByTable;
}

function validateValuesRevalueConflicts(assignmentsByTable) {
  const diagnostics = [];
  for (const assignments of assignmentsByTable.values()) {
    if (!assignments.length) {
      continue;
    }
    const tablePath = assignments[0].tablePath || [];
    if (!isValuesRevalueTable(tablePath)) {
      continue;
    }
    const valuesAssignment = assignments.find((assignment) => assignment.key === "values");
    const revalueAssignment = assignments.find((assignment) => assignment.key === "revalue");
    if (!valuesAssignment || !revalueAssignment) {
      continue;
    }
    diagnostics.push(
      new Diagnostic(
        `Table [${pathLabel(tablePath)}] cannot define both "values" and "revalue".`,
        revalueAssignment.keyRange || valuesAssignment.keyRange,
        "error",
        "msra",
        "conflicting-assignment-keys",
      ),
    );
  }
  return diagnostics;
}

function validateFuncTransportRelations(assignmentsByTable) {
  const diagnostics = [];
  for (const assignments of assignmentsByTable.values()) {
    if (!assignments.length) {
      continue;
    }
    const tablePath = assignments[0].tablePath || [];
    if (!isFuncRootTable(tablePath)) {
      continue;
    }

    const transportAssignment = assignments.find((assignment) => assignment.key === "transport");
    if (!transportAssignment || !(transportAssignment.value instanceof StringExpr)) {
      continue;
    }

    const transport = transportAssignment.value.value;
    const methodAssignment = assignments.find((assignment) => assignment.key === "method");
    if (transport === "goto") {
      if (methodAssignment) {
        diagnostics.push(
          new Diagnostic(
            `Function [${pathLabel(tablePath)}] with transport="goto" cannot define "method".`,
            methodAssignment.keyRange || transportAssignment.keyRange,
            "error",
            "msra",
            "unexpected-function-method",
          ),
        );
      }
      continue;
    }

    if (!methodAssignment) {
      diagnostics.push(
        new Diagnostic(
          `Function [${pathLabel(tablePath)}] with transport="${transport}" requires a "method" value.`,
          transportAssignment.keyRange,
          "error",
          "msra",
          "missing-function-method",
        ),
      );
    }
  }
  return diagnostics;
}

function validateFuncPostprocessRelations(tableIndex, assignmentIndex) {
  const diagnostics = [];
  for (const table of tableIndex.values()) {
    const tablePath = table.path || [];
    if (!isFuncPostprocessTable(tablePath)) {
      continue;
    }

    const funcPath = tablePath.slice(0, 3);
    const transport = getStringAssignmentValue(assignmentIndex, funcPath, "transport");
    const renderHtml = getBooleanAssignmentValue(assignmentIndex, tablePath, "render_html");
    const gotoPipeline = getAssignment(assignmentIndex, tablePath, "goto_pipeline");
    const evaluate = getAssignment(assignmentIndex, tablePath, "evaluate");

    if (gotoPipeline && transport !== "goto") {
      diagnostics.push(
        new Diagnostic(
          `Function [${pathLabel(funcPath)}] with transport="${transport || "direct/fetch"}" cannot define "goto_pipeline".`,
          gotoPipeline.keyRange,
          "error",
          "msra",
          "unexpected-function-goto-pipeline",
        ),
      );
    }

    if (evaluate) {
      if (transport === "goto") {
        continue;
      }
      if (renderHtml !== true) {
        diagnostics.push(
          new Diagnostic(
            `Function [${pathLabel(funcPath)}] with transport="${transport || "direct/fetch"}" can define "evaluate" only when postprocess.render_html=true.`,
            evaluate.keyRange,
            "error",
            "msra",
            "missing-function-render-html",
          ),
        );
      }
    }
  }
  return diagnostics;
}

function validateWarmupRelations(assignmentIndex) {
  const diagnostics = [];
  const warmupPath = ["app", "warmup"];
  const browser = getStringAssignmentValue(assignmentIndex, ["app"], "browser");
  const browserIsCamoufox = browser === "camoufox";

  for (const key of ["humanize", "block_images", "humanize_action"]) {
    const assignment = getAssignment(assignmentIndex, warmupPath, key);
    if (!assignment) {
      continue;
    }
    if (!browserIsCamoufox) {
      diagnostics.push(
        new Diagnostic(
          `Warmup option "${key}" is only available when app.browser="camoufox".`,
          assignment.keyRange,
          "error",
          "msra",
          "invalid-warmup-context",
        ),
      );
    }
  }

  const humanizeAction = getAssignment(assignmentIndex, warmupPath, "humanize_action");
  if (humanizeAction && browserIsCamoufox) {
    const humanize = getAssignment(assignmentIndex, warmupPath, "humanize");
    if (!isHumanizeEnabled(humanize && humanize.value)) {
      diagnostics.push(
        new Diagnostic(
          'Warmup option "humanize_action" requires humanize to be enabled.',
          humanizeAction.keyRange,
          "error",
          "msra",
          "invalid-warmup-context",
        ),
      );
    }
  }

  return diagnostics;
}

function validateBodyRelations(tableIndex, assignmentIndex) {
  const diagnostics = [];
  for (const table of tableIndex.values()) {
    const tablePath = table.path || [];
    if (!isBodyItemTable(tablePath)) {
      continue;
    }

    const type = getStringAssignmentValue(assignmentIndex, tablePath, "type");
    if (!type) {
      continue;
    }

    const boundaryAssignment = getAssignment(assignmentIndex, tablePath, "boundary");
    const dataAssignment = getAssignment(assignmentIndex, tablePath, "data");
    const hasUrlChild = hasUnquotedChildTable(tableIndex, tablePath, "url");
    const isMultipart = type === "multipart/form-data";
    const isFormEncoded = type === "application/x-www-form-urlencoded";

    if (isMultipart && !boundaryAssignment) {
      diagnostics.push(
        new Diagnostic(
          `Body item [${pathLabel(tablePath)}] with type "${type}" requires a "boundary" value.`,
          getAssignment(assignmentIndex, tablePath, "type")?.keyRange || table.headerRange,
          "error",
          "msra",
          "missing-body-boundary",
        ),
      );
    }

    if (!isMultipart && boundaryAssignment) {
      diagnostics.push(
        new Diagnostic(
          `Body item [${pathLabel(tablePath)}] cannot define "boundary" unless type="multipart/form-data".`,
          boundaryAssignment.keyRange,
          "error",
          "msra",
          "unexpected-body-boundary",
        ),
      );
    }

    if (!isMultipart && !dataAssignment && !(isFormEncoded && hasUrlChild)) {
      diagnostics.push(
        new Diagnostic(
          `Body item [${pathLabel(tablePath)}] requires "data" or a nested "url" table when type="${type}".`,
          getAssignment(assignmentIndex, tablePath, "type")?.keyRange || table.headerRange,
          "error",
          "msra",
          "missing-body-payload",
        ),
      );
    }

    if (hasUrlChild && !isFormEncoded) {
      diagnostics.push(
        new Diagnostic(
          `Body item [${pathLabel(tablePath)}] only allows a nested "url" table when type="application/x-www-form-urlencoded".`,
          table.headerRange,
          "error",
          "msra",
          "unexpected-body-url-table",
        ),
      );
    }

    if (tablePath.length > 4) {
      const parentPath = tablePath.slice(0, -1);
      if (isBodyItemTable(parentPath)) {
        const parentType = getStringAssignmentValue(assignmentIndex, parentPath, "type");
        if (parentType && parentType !== "multipart/form-data") {
          diagnostics.push(
            new Diagnostic(
              `Nested body table [${pathLabel(tablePath)}] requires parent body item [${pathLabel(parentPath)}] to use type="multipart/form-data".`,
              table.headerRange,
              "error",
              "msra",
              "invalid-body-parent-type",
            ),
          );
        }
      }
    }
  }
  return diagnostics;
}

function validateUrlParamValueRelations(assignmentsByTable) {
  const diagnostics = [];
  for (const assignments of assignmentsByTable.values()) {
    if (!assignments.length) {
      continue;
    }
    const tablePath = assignments[0].tablePath || [];
    if (!isValuesRevalueTable(tablePath)) {
      continue;
    }

    const valuesAssignment = assignments.find((assignment) => assignment.key === "values");
    const listAssignment = assignments.find((assignment) => assignment.key === "list");
    if (!valuesAssignment || !(valuesAssignment.value instanceof ArrayExpr)) {
      continue;
    }

    const allowMultipleDefaults = listAssignment && listAssignment.value instanceof BoolExpr && listAssignment.value.value === true;
    let defaultCount = 0;
    for (const item of valuesAssignment.value.items) {
      if (!(item instanceof InlineTableExpr)) {
        continue;
      }
      const defaultEntry = item.items.find(
        (entry) => entry.key === "default" && entry.value instanceof BoolExpr && entry.value.value === true,
      );
      if (!defaultEntry) {
        continue;
      }
      defaultCount += 1;
      if (!allowMultipleDefaults && defaultCount > 1) {
        diagnostics.push(
          new Diagnostic(
            `Table [${pathLabel(tablePath)}] cannot define multiple default values in "values" unless "list=true".`,
            defaultEntry.keyRange || valuesAssignment.keyRange,
            "error",
            "msra",
            "duplicate-url-param-default",
          ),
        );
        break;
      }
    }
  }
  return diagnostics;
}

function getAssignment(assignmentIndex, tablePath, key) {
  return assignmentIndex.get(pathKey([...tablePath, key])) || null;
}

function getStringAssignmentValue(assignmentIndex, tablePath, key) {
  const assignment = getAssignment(assignmentIndex, tablePath, key);
  if (assignment && assignment.value instanceof StringExpr) {
    return assignment.value.value;
  }
  return null;
}

function getBooleanAssignmentValue(assignmentIndex, tablePath, key) {
  const assignment = getAssignment(assignmentIndex, tablePath, key);
  if (assignment && assignment.value instanceof BoolExpr) {
    return assignment.value.value;
  }
  return null;
}

function isHumanizeEnabled(value) {
  if (value instanceof BoolExpr) {
    return value.value === true;
  }
  if (value instanceof NumberExpr) {
    return Number.isFinite(value.value) && value.value > 0;
  }
  return false;
}

function isBodyItemTable(path) {
  return Array.isArray(path)
    && path.length >= 4
    && path[0] === "app"
    && path[1] === "func"
    && path[3] === "body"
    && path[path.length - 1] !== "url";
}

function isFuncPostprocessTable(path) {
  return Array.isArray(path)
    && path.length === 4
    && path[0] === "app"
    && path[1] === "func"
    && path[3] === "postprocess";
}

function isFuncRootTable(path) {
  return Array.isArray(path)
    && path.length === 3
    && path[0] === "app"
    && path[1] === "func"
    && path[2] !== "headers";
}

function hasUnquotedChildTable(tableIndex, parentPath, childName) {
  for (const table of tableIndex.values()) {
    const childPath = table.path || [];
    if (childPath.length !== parentPath.length + 1) {
      continue;
    }
    if (!childPath.slice(0, parentPath.length).every((segment, index) => segment === parentPath[index])) {
      continue;
    }
    const lastSegment = table.pathSegments && table.pathSegments[table.pathSegments.length - 1];
    if (lastSegment && lastSegment.value === childName && !lastSegment.quoted) {
      return true;
    }
  }
  return false;
}

function isValuesRevalueTable(path) {
  return Array.isArray(path)
    && path[0] === "app"
    && path[1] === "func"
    && (
      (path.length === 5 && path[3] === "input")
      || (path.length >= 6 && path[3] === "url" && path[4] === "params")
    );
}

module.exports = {
  validateAssignmentRelations,
};
