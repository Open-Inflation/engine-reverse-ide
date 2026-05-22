const SIMPLE_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

function normalizePathSegments(pathSegments) {
  if (!Array.isArray(pathSegments)) {
    return [];
  }
  return pathSegments.map((segment) => {
    if (typeof segment === "string") {
      return {
        value: segment,
        quoted: false,
        range: null,
      };
    }
    return {
      value: String(segment && segment.value !== undefined ? segment.value : ""),
      quoted: Boolean(segment && segment.quoted),
      range: segment && segment.range ? segment.range : null,
    };
  });
}

function renderSegment(segment) {
  if (segment.quoted || !SIMPLE_SEGMENT_PATTERN.test(segment.value)) {
    return JSON.stringify(segment.value);
  }
  return segment.value;
}

function renderPath(pathSegments, endIndex = pathSegments.length) {
  return pathSegments
    .slice(0, endIndex)
    .map((segment) => renderSegment(segment))
    .join(".");
}

function validateTablePath(pathSegments) {
  const segments = normalizePathSegments(pathSegments);
  if (!segments.length) {
    return { valid: true };
  }
  return validateRootPath(segments);
}

function validateRootPath(segments) {
  const root = segments[0];
  if (root.value === "misklerreverseapi") {
    if (segments.length === 1) {
      return { valid: true };
    }
    return invalidPath(segments, 1, `Table path "${renderPath(segments)}" cannot declare child tables under "misklerreverseapi".`);
  }
  if (root.value !== "app") {
    return invalidPath(
      segments,
      0,
      `Unknown root table "${renderSegment(root)}" in "${renderPath(segments)}". Expected "app" or "misklerreverseapi".`,
      ["app", "misklerreverseapi"],
    );
  }
  if (segments.length === 1) {
    return { valid: true };
  }
  return validateAppPath(segments, 1);
}

function validateAppPath(segments, index) {
  if (index >= segments.length) {
    return { valid: true };
  }
  const segment = segments[index];
  if (segment.value === "warmup") {
    return validateLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`);
  }
  if (segment.value === "variables") {
    return validateDynamicLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`, "variable");
  }
  if (segment.value === "prefixes") {
    return validateLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`);
  }
  if (segment.value === "regexes") {
    return validateDynamicLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`, "regex");
  }
  if (segment.value === "groups") {
    return validateGroupNamespace(segments, index + 1);
  }
  if (segment.value === "func") {
    return validateFuncNamespace(segments, index + 1);
  }
  return invalidPath(
    segments,
    index,
    `Invalid child table "${renderSegment(segment)}" under "app" in "${renderPath(segments)}". Expected "warmup", "variables", "prefixes", "regexes", "groups", or "func".`,
    ["warmup", "variables", "prefixes", "regexes", "groups", "func"],
  );
}

function validateLeafNamespace(segments, index, parentLabel) {
  if (index === segments.length - 1) {
    return { valid: true };
  }
  return invalidPath(
    segments,
    index + 1,
    `Table path "${renderPath(segments)}" is rooted at ${parentLabel} and does not allow child tables.`,
  );
}

function validateDynamicLeafNamespace(segments, index, parentLabel, childLabel) {
  if (index + 2 >= segments.length) {
    return { valid: true };
  }
  return invalidPath(
    segments,
    index + 2,
    `Table path "${renderPath(segments)}" declares ${childLabel} table "${renderSegment(segments[index + 1])}" under ${parentLabel}, but that namespace only allows leaf child tables.`,
  );
}

function validateGroupNamespace(segments, index) {
  if (index >= segments.length) {
    return { valid: true };
  }
  return validateGroupNamespace(segments, index + 1);
}

function validateFuncNamespace(segments, index) {
  if (index >= segments.length) {
    return { valid: true };
  }
  return validateFuncTable(segments, index + 1);
}

function validateFuncTable(segments, index) {
  if (index >= segments.length) {
    return { valid: true };
  }
  const segment = segments[index];
  if (segment.value === "input") {
    return validateDynamicLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`, "input");
  }
  if (segment.value === "body") {
    return validateBodyNamespace(segments, index + 1, false);
  }
  if (segment.value === "headers") {
    return validateLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`);
  }
  if (segment.value === "url") {
    return validateUrlNamespace(segments, index + 1);
  }
  if (segment.value === "examples") {
    return validateLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`);
  }
  return invalidPath(
    segments,
    index,
    `Invalid child table "${renderSegment(segment)}" under "${renderPath(segments, index)}". Expected "input", "body", "headers", "url", or "examples".`,
    ["input", "body", "headers", "url", "examples"],
  );
}

function validateBodyNamespace(segments, index, seenBodyItem) {
  if (index >= segments.length) {
    return { valid: true };
  }
  const segment = segments[index];
  if (segment.value === "url" && !segment.quoted) {
    if (!seenBodyItem) {
      return invalidPath(
        segments,
        index,
        `Table path "${renderPath(segments)}" uses "url" before any body item inside "${renderPath(segments, index)}". Add at least one body item before nesting a url table, or quote the name if you need a literal body item.`,
      );
    }
    return validateUrlNamespace(segments, index + 1);
  }
  if (index === segments.length - 1) {
    return { valid: true };
  }
  return validateBodyNamespace(segments, index + 1, true);
}

function validateUrlNamespace(segments, index) {
  if (index >= segments.length) {
    return { valid: true };
  }
  const segment = segments[index];
  if (segment.value !== "params" || segment.quoted) {
    return invalidPath(
      segments,
      index,
      `Table path "${renderPath(segments)}" only allows a "params" child under "${renderPath(segments, index)}".`,
      ["params"],
    );
  }
  return validateParamsNamespace(segments, index + 1);
}

function validateParamsNamespace(segments, index) {
  if (index >= segments.length) {
    return { valid: true };
  }
  const segment = segments[index];
  if (segment.value === "params" && !segment.quoted) {
    return invalidPath(
      segments,
      index,
      `Table path "${renderPath(segments)}" uses the unquoted segment "params" where a parameter name is expected. Quote it if you need a literal parameter named params.`,
    );
  }
  if (index === segments.length - 1) {
    return { valid: true };
  }
  const next = segments[index + 1];
  if (next.value !== "params" || next.quoted) {
    return invalidPath(
      segments,
      index + 1,
      `Table path "${renderPath(segments)}" only allows a nested "params" namespace after parameter "${renderSegment(segment)}".`,
      ["params"],
    );
  }
  return validateParamsNamespace(segments, index + 2);
}

function invalidPath(segments, segmentIndex, message, expected = []) {
  return {
    valid: false,
    code: "invalid-table-path",
    message,
    segmentIndex,
    expected,
  };
}

module.exports = {
  normalizePathSegments,
  renderPath,
  renderSegment,
  validateTablePath,
};
