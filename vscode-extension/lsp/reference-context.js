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
  return pathMatches(tablePath, ["app", "func", "*", "examples"]) && pathStartsWith(valuePathSegments, ["examples", "inputs"]);
}

function isFuncResultReferenceContext(tablePath, valuePathSegments) {
  return isExampleInputsValuePath(tablePath, valuePathSegments) && normalizePathSegments(valuePathSegments).length >= 3;
}

module.exports = {
  DEFAULT_REFERENCE_ROOTS,
  EXAMPLE_INPUT_REFERENCE_ROOTS,
  isExampleInputsValuePath,
  isFuncResultReferenceContext,
  pathMatches,
  pathStartsWith,
};
