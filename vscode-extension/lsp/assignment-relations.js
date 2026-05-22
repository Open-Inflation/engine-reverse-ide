const { Diagnostic, pathKey, pathLabel } = require("./model");

function validateAssignmentRelations(assignmentIndex) {
  const diagnostics = [];
  const assignmentsByTable = new Map();

  for (const assignment of assignmentIndex.values()) {
    const key = pathKey(assignment.tablePath);
    if (!assignmentsByTable.has(key)) {
      assignmentsByTable.set(key, []);
    }
    assignmentsByTable.get(key).push(assignment);
  }

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
