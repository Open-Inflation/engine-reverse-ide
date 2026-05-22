const { Diagnostic, MergeExpr, SequenceExpr, StringExpr } = require("./model");
const { normalizePathSegments, renderPath } = require("./path-schema");

function validateGroupAssignments(tableIndex, assignmentIndex) {
  const availableGroups = collectAvailableGroups(tableIndex);

  const diagnostics = [];
  for (const assignment of assignmentIndex.values()) {
    if (!isFunctionGroupAssignment(assignment)) {
      continue;
    }

    const groupName = resolveStaticString(assignment.value);
    if (groupName === null) {
      continue;
    }

    if (availableGroups.has(groupName)) {
      continue;
    }

    diagnostics.push(
      new Diagnostic(
        buildMissingGroupMessage(groupName, availableGroups),
        assignment.valueRange,
        "error",
        "msra",
        "missing-group",
      ),
    );
  }

  return diagnostics;
}

function collectAvailableGroups(tableIndex) {
  const groups = new Map();
  for (const table of tableIndex.values()) {
    if (table.path.length < 3 || table.path[0] !== "app" || table.path[1] !== "groups") {
      continue;
    }
    const groupPath = renderGroupName(table);
    if (groupPath) {
      groups.set(groupPath, table.path);
    }
  }
  return groups;
}

function isFunctionGroupAssignment(assignment) {
  return (
    assignment.key === "group" &&
    assignment.tablePath.length === 3 &&
    assignment.tablePath[0] === "app" &&
    assignment.tablePath[1] === "func"
  );
}

function resolveStaticString(value) {
  if (value instanceof StringExpr) {
    return value.value;
  }
  if (value instanceof SequenceExpr || value instanceof MergeExpr) {
    const parts = [];
    for (const part of value.items || value.parts || []) {
      const resolved = resolveStaticString(part);
      if (resolved === null) {
        return null;
      }
      parts.push(resolved);
    }
    return parts.join("");
  }
  return null;
}

function buildMissingGroupMessage(groupName, availableGroups) {
  const groups = [...availableGroups.keys()].sort();
  if (!groups.length) {
    return `Group "${groupName}" does not exist. No [app.groups.*] tables are defined in this document.`;
  }
  return `Group "${groupName}" does not exist. Expected one of: ${groups.join(", ")}.`;
}

function renderGroupName(table) {
  const segments = table.pathSegments || normalizePathSegments(table.path);
  if (!segments || segments.length < 3) {
    return "";
  }
  return renderPath(segments.slice(2));
}

module.exports = {
  collectAvailableGroups,
  resolveStaticString,
  renderGroupName,
  validateGroupAssignments,
};
