const {
  ArrayExpr,
  BoolExpr,
  Diagnostic,
  InlineTableExpr,
  MergeExpr,
  NullExpr,
  NumberExpr,
  RefExpr,
  SequenceExpr,
  StringExpr,
  pathLabel,
} = require("./model");

const ANY = { kind: "any" };
const STRINGISH = { kind: "stringish" };
const STRING = { kind: "string" };
const BOOLEAN = { kind: "boolean" };
const INTEGER = { kind: "integer" };
const ARRAY = { kind: "array" };
const OBJECT = { kind: "object" };
const NULL = { kind: "null" };
const NULL_OR_STRING = { kind: "oneOf", options: [NULL, STRINGISH] };

function enumOf(values) {
  return { kind: "enum", values };
}

function patternOf(pattern, description) {
  return { kind: "pattern", pattern, description };
}

function oneOf(...options) {
  return { kind: "oneOf", options };
}

function arrayOf(item) {
  return { kind: "arrayOf", item };
}

function exactPath(expected) {
  return (path) => path.length === expected.length && expected.every((segment, index) => segment === "*" || segment === path[index]);
}

function pathStartsWith(prefix) {
  return (path) => prefix.length <= path.length && prefix.every((segment, index) => segment === "*" || segment === path[index]);
}

function matchesGroupPath(path) {
  return path.length >= 3 && path[0] === "app" && path[1] === "groups";
}

function matchesBodyPath(path) {
  return path.length >= 4 && path[0] === "app" && path[1] === "func" && path[3] === "body" && path[path.length - 1] !== "url";
}

function matchesUrlPath(path) {
  return path.length === 4 && path[0] === "app" && path[1] === "func" && path[3] === "url";
}

function matchesUrlParamsPath(path) {
  if (path.length < 6 || path[0] !== "app" || path[1] !== "func" || path[3] !== "url" || path[4] !== "params") {
    return false;
  }
  let index = 5;
  while (index < path.length) {
    if (index === path.length - 1) {
      return true;
    }
    index += 1;
    if (index >= path.length || path[index] !== "params") {
      return false;
    }
    index += 1;
    if (index >= path.length) {
      return false;
    }
  }
  return false;
}

function matchesBodyUrlPath(path) {
  return path.length >= 7 && path[0] === "app" && path[1] === "func" && path[3] === "body" && path[path.length - 1] === "url";
}

function makeFixedSchema(match, keys, options = {}) {
  return {
    match,
    allowUnknownKeys: Boolean(options.allowUnknownKeys),
    keys,
  };
}

function makeDynamicSchema(match, valueSpec, options = {}) {
  return {
    match,
    allowUnknownKeys: true,
    valueSpec,
    keyDescription: options.keyDescription || "entry",
  };
}

const INPUT_TYPE_SPEC = oneOf(
  enumOf(["string", "integer", "boolean", "null", "array", "object"]),
  arrayOf(enumOf(["string", "integer", "boolean", "null", "array", "object"])),
);

const BROWSER_SPEC = enumOf(["chromium", "firefox", "webkit", "camoufox"]);
const METHOD_SPEC = enumOf(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const CORS_MODE_SPEC = enumOf(["cors", "no-cors", "same-origin"]);
const CREDENTIALS_SPEC = enumOf(["omit", "same-origin", "include"]);

const BODY_TYPE_SPEC = patternOf(
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[^;]+)*$/i,
  "browser-supported MIME type",
);
const CLASS_NAME_PATTERN_SPEC = patternOf(
  /\{class_name(?:\.(?:lower|upper))?\}/,
  'template containing "{class_name}", "{class_name.lower}", or "{class_name.upper}"',
);
const SCREENSHOT_PATH_SPEC = patternOf(
  /\.(?:jpe?g|png)$/i,
  "path ending in .jpg, .jpeg, or .png",
);

const TABLE_SCHEMAS = [
  makeFixedSchema(exactPath(["misklerreverseapi"]), {
    version: STRINGISH,
  }),
  makeFixedSchema(exactPath(["app"]), {
    name: STRINGISH,
    version: STRINGISH,
    timeout_ms: INTEGER,
    class_name_pattern: CLASS_NAME_PATTERN_SPEC,
  }),
  makeFixedSchema(exactPath(["app", "warmup"]), {
    browser: BROWSER_SPEC,
    url: ANY,
    pipeline: ARRAY,
    headers_sniffer: BOOLEAN,
    error_selector: STRINGISH,
    on_error_screenshot_path: SCREENSHOT_PATH_SPEC,
    wait_url: ANY,
    timeout_ms: INTEGER,
  }),
  makeFixedSchema(exactPath(["app", "variables", "*"]), {
    types: ARRAY,
    description: STRINGISH,
    from: ANY,
  }),
  makeDynamicSchema(exactPath(["app", "prefixes"]), STRINGISH, {
    keyDescription: "prefix",
  }),
  makeFixedSchema(exactPath(["app", "regexes", "*"]), {
    regex: STRINGISH,
    actions: ARRAY,
    raise: STRINGISH,
    description: STRINGISH,
  }),
  makeFixedSchema(matchesGroupPath, {
    description: STRINGISH,
  }),
  makeFixedSchema(exactPath(["app", "func", "*"]), {
    name: STRINGISH,
    render_html: BOOLEAN,
    method: METHOD_SPEC,
    group: STRINGISH,
    color: STRINGISH,
    description: STRINGISH,
  }),
  makeFixedSchema(exactPath(["app", "func", "*", "input", "*"]), {
    type: INPUT_TYPE_SPEC,
    description: STRINGISH,
    required: BOOLEAN,
    default: ANY,
    values: ARRAY,
    data: ANY,
    revalue: ANY,
  }),
  makeFixedSchema(matchesBodyPath, {
    type: BODY_TYPE_SPEC,
    charset: NULL_OR_STRING,
    boundary: STRINGISH,
    return_name: BOOLEAN,
    filename: ANY,
    data: ANY,
  }),
  makeFixedSchema(matchesBodyUrlPath, {
    prefix: ANY,
    base: STRINGISH,
  }),
  makeFixedSchema(exactPath(["app", "func", "*", "headers"]), {
    referrer: ANY,
    cors_mode: CORS_MODE_SPEC,
    credentials: CREDENTIALS_SPEC,
    headers: ANY,
  }),
  makeFixedSchema(matchesUrlPath, {
    prefix: ANY,
    base: STRINGISH,
  }),
  makeFixedSchema(matchesUrlParamsPath, {
    sub_url: BOOLEAN,
    required: BOOLEAN,
    list: BOOLEAN,
    list_style: OBJECT,
    values: ARRAY,
    description: STRINGISH,
    data: ANY,
    revalue: ANY,
  }),
  makeFixedSchema(exactPath(["app", "func", "*", "examples"]), {
    examples: ARRAY,
    test: BOOLEAN,
  }),
];

function validateAssignment(tablePath, assignment) {
  const schema = findSchema(tablePath);
  if (schema === null) {
    return [];
  }
  if (schema.allowUnknownKeys !== true && !Object.prototype.hasOwnProperty.call(schema.keys, assignment.key)) {
    return [
      new Diagnostic(
        `Unknown assignment "${assignment.key}" in table [${pathLabel(tablePath)}]. Expected one of: ${Object.keys(schema.keys).join(", ")}.`,
        assignment.keyRange,
        "error",
        "msra",
        "unknown-assignment-key",
      ),
    ];
  }
  const spec = schema.allowUnknownKeys === true ? schema.valueSpec : schema.keys[assignment.key];
  if (!spec) {
    return [];
  }
  const valueError = validateValueSpec(assignment.value, spec, assignment);
  if (valueError === null) {
    return [];
  }
  return [
    new Diagnostic(
      valueError,
      assignment.valueRange,
      "error",
      "msra",
      "invalid-assignment-value-type",
    ),
  ];
}

function findSchema(tablePath) {
  for (const schema of TABLE_SCHEMAS) {
    if (schema.match(tablePath)) {
      return schema;
    }
  }
  return null;
}

function validateValueSpec(value, spec) {
  if (spec.kind === "any") {
    return null;
  }
  if (spec.kind === "oneOf") {
    for (const option of spec.options) {
      if (validateValueSpec(value, option) === null) {
        return null;
      }
    }
    return `Expected one of: ${spec.options.map(describeSpec).join(", ")}`;
  }
  if (spec.kind === "arrayOf") {
    if (!(value instanceof ArrayExpr)) {
      return `Expected ${describeSpec(spec)} but got ${describeValue(value)}`;
    }
    for (const item of value.items) {
      if (validateValueSpec(item, spec.item) !== null) {
        return `Expected ${describeSpec(spec)} but got ${describeValue(value)}`;
      }
    }
    return null;
  }
  if (spec.kind === "enum") {
    if (value instanceof StringExpr && spec.values.includes(value.value)) {
      return null;
    }
    return `Expected ${describeSpec(spec)} but got ${describeValue(value)}`;
  }
  if (spec.kind === "stringish") {
    if (value instanceof StringExpr || value instanceof SequenceExpr || value instanceof MergeExpr || value instanceof RefExpr) {
      return null;
    }
    return `Expected ${describeSpec(spec)} but got ${describeValue(value)}`;
  }
  if (spec.kind === "pattern") {
    if (value instanceof StringExpr && spec.pattern.test(value.value)) {
      return null;
    }
    return `Expected ${describeSpec(spec)} but got ${describeValue(value)}`;
  }
  if (spec.kind === "string") {
    if (value instanceof StringExpr) {
      return null;
    }
    return `Expected ${describeSpec(spec)} but got ${describeValue(value)}`;
  }
  if (spec.kind === "boolean") {
    if (value instanceof BoolExpr) {
      return null;
    }
    return `Expected ${describeSpec(spec)} but got ${describeValue(value)}`;
  }
  if (spec.kind === "integer") {
    if (value instanceof NumberExpr && Number.isInteger(value.value) && !/[.eE]/.test(value.raw)) {
      return null;
    }
    return `Expected ${describeSpec(spec)} but got ${describeValue(value)}`;
  }
  if (spec.kind === "array") {
    if (value instanceof ArrayExpr) {
      return null;
    }
    return `Expected ${describeSpec(spec)} but got ${describeValue(value)}`;
  }
  if (spec.kind === "object") {
    if (value instanceof InlineTableExpr) {
      return null;
    }
    return `Expected ${describeSpec(spec)} but got ${describeValue(value)}`;
  }
  if (spec.kind === "null") {
    if (value instanceof NullExpr) {
      return null;
    }
    return `Expected ${describeSpec(spec)} but got ${describeValue(value)}`;
  }
  return null;
}

function describeSpec(spec) {
  if (spec.kind === "oneOf") {
    return spec.options.map(describeSpec).join(" or ");
  }
  if (spec.kind === "arrayOf") {
    return `array of ${describeSpec(spec.item)}`;
  }
  if (spec.kind === "enum") {
    return `one of ${spec.values.map((value) => JSON.stringify(value)).join(", ")}`;
  }
  if (spec.kind === "pattern") {
    return spec.description || `string matching ${spec.pattern}`;
  }
  return spec.kind;
}

function describeValue(value) {
  if (value instanceof StringExpr) {
    return "string";
  }
  if (value instanceof NumberExpr) {
    return Number.isInteger(value.value) && !/[.eE]/.test(value.raw) ? "integer" : "number";
  }
  if (value instanceof BoolExpr) {
    return "boolean";
  }
  if (value instanceof NullExpr) {
    return "null";
  }
  if (value instanceof ArrayExpr) {
    return "array";
  }
  if (value instanceof InlineTableExpr) {
    return "inline table";
  }
  if (value instanceof RefExpr) {
    return "reference";
  }
  if (value instanceof SequenceExpr || value instanceof MergeExpr) {
    return "string interpolation";
  }
  return "value";
}

module.exports = {
  ANY,
  ARRAY,
  BOOLEAN,
  INTEGER,
  NULL,
  NULL_OR_STRING,
  OBJECT,
  STRING,
  STRINGISH,
  TABLE_SCHEMAS,
  arrayOf,
  describeSpec,
  describeValue,
  enumOf,
  findSchema,
  oneOf,
  validateAssignment,
  validateValueSpec,
};
