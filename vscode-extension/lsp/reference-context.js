const { normalizePathSegments } = require("./path-schema");

const DEFAULT_REFERENCE_ROOTS = [
  "DOCUMENT.PREFIXES",
  "DOCUMENT.REGEXES",
  "VARIABLES",
  "GROUPS",
  "INPUT",
  "UNSTANDARD_HEADERS",
  "CAPTURED_URLS",
  "COOKIES",
  "LOCAL_STORAGE",
  "SESSION_STORAGE",
];

const EXAMPLE_INPUT_REFERENCE_ROOTS = [...DEFAULT_REFERENCE_ROOTS, "FUNCRESULT"];
const FUNCRESULT_RESULT_TYPES = new Set(["JSON", "TEXT", "IMAGE"]);

function pathMatches(pathSegments, pattern) {
  const path = normalizePathSegments(pathSegments).map((segment) => String(segment.value));
  if (!Array.isArray(pattern) || path.length !== pattern.length) {
    return false;
  }
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] === "*") {
      continue;
    }
    if (path[index] !== pattern[index]) {
      return false;
    }
  }
  return true;
}

function pathStartsWith(pathSegments, prefix) {
  const path = normalizePathSegments(pathSegments).map((segment) => String(segment.value));
  if (!Array.isArray(prefix) || prefix.length > path.length) {
    return false;
  }
  for (let index = 0; index < prefix.length; index += 1) {
    if (path[index] !== prefix[index]) {
      return false;
    }
  }
  return true;
}

function isExampleInputsValuePath(tablePath, valuePathSegments) {
  return pathMatches(tablePath, ["app", "func", "*", "examples", "*"]) && pathStartsWith(valuePathSegments, ["inputs"]);
}

function isFuncResultReferenceContext(tablePath, valuePathSegments) {
  return isExampleInputsValuePath(tablePath, valuePathSegments) && normalizePathSegments(valuePathSegments).length >= 2;
}

function parseFuncResultReference(ref, tablePath, valuePathSegments) {
  const parts = ref && Array.isArray(ref.parts) ? ref.parts : [];
  if (!parts.length || parts[0].kind !== "name" || String(parts[0].value) !== "FUNCRESULT") {
    return null;
  }

  if (!isExampleInputsValuePath(tablePath, valuePathSegments)) {
    return {
      valid: false,
      code: "invalid-funcresult-reference",
      message: 'FUNCRESULT references are only allowed inside [app.func.*.examples.<name>] inputs.<key>.value.',
      range: ref.range || null,
    };
  }

  const functionPart = parts[1] || null;
  if (!functionPart || functionPart.kind !== "name") {
    return {
      valid: false,
      code: "invalid-funcresult-reference",
      message: 'FUNCRESULT references must use the form <FUNCRESULT.<function>.JSON|TEXT|IMAGE>.',
      range: ref.range || null,
    };
  }

  const resultPart = parts[2] || null;
  if (!resultPart || resultPart.kind !== "name") {
    return {
      valid: false,
      code: "invalid-funcresult-reference",
      message: 'FUNCRESULT references must include a result kind: JSON, TEXT, or IMAGE.',
      range: ref.range || null,
    };
  }

  const resultKind = String(resultPart.value);
  if (!FUNCRESULT_RESULT_TYPES.has(resultKind)) {
    return {
      valid: false,
      code: "invalid-funcresult-reference",
      message: 'FUNCRESULT references must use the result kind JSON, TEXT, or IMAGE.',
      range: resultPart.range || ref.range || null,
    };
  }

  if (resultKind !== "JSON" && parts.length > 3) {
    return {
      valid: false,
      code: "invalid-funcresult-reference",
      message: `FUNCRESULT.${String(functionPart.value)}.${resultKind} does not allow further path access. Use JSON if you need to address nested elements.`,
      range: parts[3] && parts[3].range ? parts[3].range : ref.range || null,
    };
  }

  return {
    valid: true,
    functionId: String(functionPart.value),
    resultKind,
    tailParts: parts.slice(3),
    range: ref.range || null,
  };
}

module.exports = {
  DEFAULT_REFERENCE_ROOTS,
  EXAMPLE_INPUT_REFERENCE_ROOTS,
  FUNCRESULT_RESULT_TYPES,
  isExampleInputsValuePath,
  isFuncResultReferenceContext,
  parseFuncResultReference,
  pathMatches,
  pathStartsWith,
};
