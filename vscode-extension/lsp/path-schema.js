const SIMPLE_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const TABLE_ROOT_SEGMENTS = new Set([
  "app",
  "msra",
]);

const APP_CHILD_SEGMENTS = new Set([
  "warmup",
  "defaults",
  "variables",
  "prefixes",
  "regexes",
  "groups",
  "func",
]);

const FUNC_CHILD_SEGMENTS = new Set([
  "input",
  "body",
  "headers",
  "url",
  "examples",
  "extractor",
]);

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

function pathIdentityKey(pathSegments) {
  const segments = normalizePathSegments(pathSegments);
  const tokens = [];
  if (!segments.length) {
    return JSON.stringify(tokens);
  }

  const root = segments[0];
  if (segmentValue(root) === "app" && !segmentQuoted(root)) {
    pushIdentityToken(tokens, "system", root);
    if (segments.length === 1) {
      return JSON.stringify(tokens);
    }
    const child = segments[1];
    if (!segmentQuoted(child) && APP_CHILD_SEGMENTS.has(String(segmentValue(child)))) {
      pushIdentityToken(tokens, "system", child);
      appendAppBranchIdentity(tokens, segments, 2, String(segmentValue(child)));
      return JSON.stringify(tokens);
    }
    pushIdentityToken(tokens, "custom", child);
    appendRemainingCustomIdentity(tokens, segments, 2);
    return JSON.stringify(tokens);
  }

  if (segmentValue(root) === "msra" && !segmentQuoted(root)) {
    pushIdentityToken(tokens, "system", root);
    appendRemainingCustomIdentity(tokens, segments, 1);
    return JSON.stringify(tokens);
  }

  pushIdentityToken(tokens, "custom", root);
  appendRemainingCustomIdentity(tokens, segments, 1);
  return JSON.stringify(tokens);
}

function appendAppBranchIdentity(tokens, segments, index, branchName) {
  if (branchName === "groups") {
    appendRemainingCustomIdentity(tokens, segments, index);
    return;
  }

  if (branchName === "defaults") {
    if (index >= segments.length) {
      return;
    }
    const child = segments[index];
    if (!segmentQuoted(child) && segmentValue(child) === "func") {
      pushIdentityToken(tokens, "system", child);
      if (index + 1 >= segments.length) {
        return;
      }
      const grandChild = segments[index + 1];
      if (!segmentQuoted(grandChild) && segmentValue(grandChild) === "headers") {
        pushIdentityToken(tokens, "system", grandChild);
        appendRemainingCustomIdentity(tokens, segments, index + 2);
        return;
      }
      pushIdentityToken(tokens, "custom", grandChild);
      appendRemainingCustomIdentity(tokens, segments, index + 2);
      return;
    }
    pushIdentityToken(tokens, "custom", child);
    appendRemainingCustomIdentity(tokens, segments, index + 1);
    return;
  }

  if (branchName === "variables" || branchName === "regexes") {
    if (index >= segments.length) {
      return;
    }
    pushIdentityToken(tokens, "custom", segments[index]);
    appendRemainingCustomIdentity(tokens, segments, index + 1);
    return;
  }

  if (branchName === "prefixes" || branchName === "warmup") {
    appendRemainingCustomIdentity(tokens, segments, index);
    return;
  }

  if (branchName === "func") {
    appendFuncIdentity(tokens, segments, index);
    return;
  }

  appendRemainingCustomIdentity(tokens, segments, index);
}

function appendFuncIdentity(tokens, segments, index) {
  if (index >= segments.length) {
    return;
  }

  const functionId = segments[index];
  pushIdentityToken(tokens, "custom", functionId);
  if (index + 1 >= segments.length) {
    return;
  }

  const child = segments[index + 1];
  if (!segmentQuoted(child) && FUNC_CHILD_SEGMENTS.has(String(segmentValue(child)))) {
    pushIdentityToken(tokens, "system", child);
    appendFuncChildIdentity(tokens, segments, index + 2, String(segmentValue(child)));
    return;
  }

  pushIdentityToken(tokens, "custom", child);
  appendRemainingCustomIdentity(tokens, segments, index + 2);
}

function appendFuncChildIdentity(tokens, segments, index, branchName) {
  if (branchName === "body") {
    appendBodyIdentity(tokens, segments, index);
    return;
  }

  if (branchName === "url") {
    appendUrlParamsIdentity(tokens, segments, index);
    return;
  }

  appendRemainingCustomIdentity(tokens, segments, index);
}

function appendBodyIdentity(tokens, segments, index) {
  let seenBodyItem = false;
  let currentIndex = index;
  while (currentIndex < segments.length) {
    const segment = segments[currentIndex];
    if (!segmentQuoted(segment) && segmentValue(segment) === "url" && seenBodyItem) {
      pushIdentityToken(tokens, "system", segment);
      appendUrlParamsIdentity(tokens, segments, currentIndex + 1);
      return;
    }
    pushIdentityToken(tokens, "custom", segment);
    seenBodyItem = true;
    currentIndex += 1;
  }
}

function appendUrlParamsIdentity(tokens, segments, index) {
  let position = 0;
  let currentIndex = index;
  while (currentIndex < segments.length) {
    const segment = segments[currentIndex];
    if (position % 2 === 0 && !segmentQuoted(segment) && segmentValue(segment) === "params") {
      pushIdentityToken(tokens, "system", segment);
    } else {
      pushIdentityToken(tokens, "custom", segment);
    }
    position += 1;
    currentIndex += 1;
  }
}

function appendRemainingCustomIdentity(tokens, segments, index) {
  for (let currentIndex = index; currentIndex < segments.length; currentIndex += 1) {
    pushIdentityToken(tokens, "custom", segments[currentIndex]);
  }
}

function pushIdentityToken(tokens, kind, segment) {
  tokens.push(`${kind}:${String(segmentValue(segment))}`);
}

function segmentValue(segment) {
  if (segment && typeof segment === "object" && Object.prototype.hasOwnProperty.call(segment, "value")) {
    return segment.value;
  }
  return segment;
}

function segmentQuoted(segment) {
  if (segment && typeof segment === "object" && Object.prototype.hasOwnProperty.call(segment, "quoted")) {
    return Boolean(segment.quoted);
  }
  return false;
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
  if (root.value === "msra" && !root.quoted) {
    if (segments.length === 1) {
      return { valid: true };
    }
    return invalidPath(segments, 1, `Table path "${renderPath(segments)}" cannot declare child tables under "msra".`);
  }
  if (root.value !== "app" || root.quoted) {
    return invalidPath(
      segments,
      0,
      `Unknown root table "${renderSegment(root)}" in "${renderPath(segments)}". Expected "app" or "msra".`,
      ["app", "msra"],
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
  if (segment.value === "warmup" && !segment.quoted) {
    return validateLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`);
  }
  if (segment.value === "defaults" && !segment.quoted) {
    return validateDefaultsNamespace(segments, index + 1);
  }
  if (segment.value === "variables" && !segment.quoted) {
    return validateDynamicLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`, "variable");
  }
  if (segment.value === "prefixes" && !segment.quoted) {
    return validateLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`);
  }
  if (segment.value === "regexes" && !segment.quoted) {
    return validateDynamicLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`, "regex");
  }
  if (segment.value === "groups" && !segment.quoted) {
    return validateGroupNamespace(segments, index + 1);
  }
  if (segment.value === "func" && !segment.quoted) {
    return validateFuncNamespace(segments, index + 1);
  }
  return invalidPath(
    segments,
    index,
    `Invalid child table "${renderSegment(segment)}" under "app" in "${renderPath(segments)}". Expected "warmup", "defaults", "variables", "prefixes", "regexes", "groups", or "func".`,
    ["warmup", "defaults", "variables", "prefixes", "regexes", "groups", "func"],
  );
}

function validateDefaultsNamespace(segments, index) {
  if (index >= segments.length) {
    return { valid: true };
  }
  const segment = segments[index];
  if (segment.value === "func" && !segment.quoted) {
    return validateDefaultsFuncNamespace(segments, index + 1);
  }
  return invalidPath(
    segments,
    index,
    `Invalid child table "${renderSegment(segment)}" under "app.defaults" in "${renderPath(segments)}". Expected "func".`,
    ["func"],
  );
}

function validateDefaultsFuncNamespace(segments, index) {
  if (index >= segments.length) {
    return { valid: true };
  }
  const segment = segments[index];
  if (segment.value === "headers" && !segment.quoted) {
    return validateLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`);
  }
  return invalidPath(
    segments,
    index,
    `Invalid child table "${renderSegment(segment)}" under "app.defaults.func" in "${renderPath(segments)}". Expected "headers".`,
    ["headers"],
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
  if (segment.value === "input" && !segment.quoted) {
    return validateInputNamespace(segments, index + 1);
  }
  if (segment.value === "body" && !segment.quoted) {
    return validateBodyNamespace(segments, index + 1, false);
  }
  if (segment.value === "headers" && !segment.quoted) {
    return validateLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`);
  }
  if (segment.value === "url" && !segment.quoted) {
    return validateUrlNamespace(segments, index + 1);
  }
  if (segment.value === "examples" && !segment.quoted) {
    if (index === segments.length - 1) {
      return { valid: true };
    }
    return validateExampleNamespace(segments, index + 1, `"${renderPath(segments, index + 1)}"`);
  }
  if (segment.value === "extractor" && !segment.quoted) {
    return validateLeafNamespace(segments, index, `"${renderPath(segments, index + 1)}"`);
  }
  if (segment.value === "overload" && !segment.quoted) {
    return validateFuncOverloadNamespace(segments, index + 1, `"${renderPath(segments, index + 1)}"`);
  }
  return invalidPath(
    segments,
    index,
    `Invalid child table "${renderSegment(segment)}" under "${renderPath(segments, index)}". Expected "input", "body", "headers", "url", "examples", "extractor", or "overload".`,
    ["input", "body", "headers", "url", "examples", "extractor", "overload"],
  );
}

function validateFuncOverloadNamespace(segments, index, parentLabel) {
  if (index >= segments.length) {
    return invalidPath(
      segments,
      index,
      `Table path "${renderPath(segments)}" is rooted at ${parentLabel} and only allows a single overload name under "overload".`,
    );
  }
  if (index === segments.length - 1) {
    return { valid: true };
  }
  return invalidPath(
    segments,
    index + 1,
    `Table path "${renderPath(segments)}" is rooted at ${parentLabel} and does not allow child tables.`,
  );
}

function validateInputNamespace(segments, index) {
  if (index >= segments.length) {
    return { valid: true };
  }
  if (index === segments.length - 1) {
    return { valid: true };
  }
  const segment = segments[index + 1];
  if (segment.value === "overload" && !segment.quoted) {
    return validateInputOverloadNamespace(segments, index + 2, `"${renderPath(segments, index + 1)}"`);
  }
  return invalidPath(
    segments,
    index + 1,
    `Table path "${renderPath(segments)}" declares child table "${renderSegment(segment)}" under input "${renderSegment(segments[index])}", but only "overload" is allowed.`,
    ["overload"],
  );
}

function validateInputOverloadNamespace(segments, index, parentLabel) {
  if (index >= segments.length) {
    return invalidPath(
      segments,
      index,
      `Table path "${renderPath(segments)}" is rooted at ${parentLabel} and only allows a single overload name under "overload".`,
    );
  }
  if (index === segments.length - 1) {
    return { valid: true };
  }
  return invalidPath(
    segments,
    index + 1,
    `Table path "${renderPath(segments)}" is rooted at ${parentLabel} and does not allow child tables.`,
  );
}

function validateExampleNamespace(segments, index, parentLabel) {
  if (index >= segments.length) {
    return { valid: true };
  }
  if (index === segments.length - 1) {
    return { valid: true };
  }
  return invalidPath(
    segments,
    index + 1,
    `Table path "${renderPath(segments)}" is rooted at ${parentLabel} and only allows a single example table name under "examples".`,
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
  pathIdentityKey,
  validateTablePath,
};
