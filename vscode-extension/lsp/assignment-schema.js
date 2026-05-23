const {
  ArrayExpr,
  BoolExpr,
  Diagnostic,
  InlineTableExpr,
  IdentExpr,
  MergeExpr,
  NullExpr,
  NumberExpr,
  RefExpr,
  SequenceExpr,
  StringExpr,
  Position,
  Range,
  pathLabel,
} = require("./model");

const ANY = { kind: "any" };
const STRINGISH = { kind: "stringish" };
const STRING = { kind: "string" };
const BOOLEAN = { kind: "boolean" };
const INTEGER = { kind: "integer" };
const NUMBER = { kind: "number" };
const ARRAY = { kind: "array" };
const OBJECT = { kind: "object" };
const NULL = { kind: "null" };
const NULL_OR_STRING = { kind: "oneOf", options: [NULL, STRINGISH] };

function enumOf(values) {
  return { kind: "enum", values };
}

function referenceOf(roots) {
  return {
    kind: "reference",
    roots: Array.isArray(roots) ? roots : [roots],
  };
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

function integerAtLeast(min) {
  return {
    kind: "integer",
    min,
  };
}

function numberGreaterThan(min) {
  return {
    kind: "number",
    min,
    exclusiveMin: true,
  };
}

function objectShape(required = {}, optional = {}, options = {}) {
  return {
    kind: "objectShape",
    required,
    optional,
    allowUnknownKeys: Boolean(options.allowUnknownKeys),
    rules: Array.isArray(options.rules) ? options.rules : [],
  };
}

function recordOf(valueSpec, options = {}) {
  return {
    kind: "recordOf",
    valueSpec,
    keyDescription: options.keyDescription || "entry",
  };
}

function requireKeyUnlessBooleanTrue(requiredKey, triggerKey, options = {}) {
  return {
    kind: "requireKeyUnlessBooleanTrue",
    requiredKey,
    triggerKey,
    code: options.code || "missing-conditional-inline-table-key",
    message: options.message || `Expected key "${requiredKey}" unless "${triggerKey}=true".`,
  };
}

function requireKeyWhenValue(requiredKey, triggerKey, triggerValues, options = {}) {
  return {
    kind: "requireKeyWhenValue",
    requiredKey,
    triggerKey,
    triggerValues: Array.isArray(triggerValues) ? triggerValues : [triggerValues],
    valueSpec: options.valueSpec || null,
    code: options.code || "missing-conditional-inline-table-key",
    message: options.message || `Expected key "${requiredKey}" when "${triggerKey}" matches the configured action.`,
  };
}

function forbidKeyWhenValue(forbiddenKey, triggerKey, triggerValues, options = {}) {
  return {
    kind: "forbidKeyWhenValue",
    forbiddenKey,
    triggerKey,
    triggerValues: Array.isArray(triggerValues) ? triggerValues : [triggerValues],
    code: options.code || "unexpected-conditional-inline-table-key",
    message: options.message || `Expected no key "${forbiddenKey}" when "${triggerKey}" matches the configured action.`,
  };
}

function forbidKeyWhenPresent(forbiddenKey, triggerKey, options = {}) {
  return {
    kind: "forbidKeyWhenPresent",
    forbiddenKey,
    triggerKey,
    code: options.code || "conflicting-inline-table-keys",
    message: options.message || `Table item cannot define both "${triggerKey}" and "${forbiddenKey}".`,
  };
}

function requireKeyOrder(lowerKey, upperKey, options = {}) {
  return {
    kind: "requireKeyOrder",
    lowerKey,
    upperKey,
    code: options.code || "invalid-inline-table-value-order",
    message: options.message || `Expected key "${upperKey}" to be greater than or equal to key "${lowerKey}".`,
  };
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

function matchesFuncHeadersPath(path) {
  if (path.length === 3) {
    return path[0] === "app" && path[1] === "func" && path[2] === "headers";
  }
  return path.length === 4 && path[0] === "app" && path[1] === "func" && path[3] === "headers";
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

const INPUT_TYPE_VALUE_SPEC = enumOf(["string", "integer", "boolean", "null", "array", "object"]);
const INPUT_LIST_TYPE_SPEC = { kind: "input-list-type", valueSpec: INPUT_TYPE_VALUE_SPEC };
const INPUT_TYPE_SPEC = oneOf(
  INPUT_TYPE_VALUE_SPEC,
  INPUT_LIST_TYPE_SPEC,
  arrayOf(INPUT_TYPE_VALUE_SPEC),
);

const EXAMPLE_INPUTS_SPEC = recordOf(ANY, {
  keyDescription: "input",
});
const EXAMPLE_ITEM_SPEC = objectShape(
  {
    file: STRINGISH,
  },
  {
    inputs: EXAMPLE_INPUTS_SPEC,
    test: BOOLEAN,
  },
);

const NUMERIC_RANGE_SPEC = objectShape(
  {
    from: NUMBER,
    to: NUMBER,
  },
  {},
  {
    rules: [
      requireKeyOrder("from", "to", {
        message: 'Expected key "to" to be greater than or equal to key "from" in numeric range.',
      }),
    ],
  },
);

const REVALUE_SPEC = { kind: "revalue" };

const VARIABLE_TYPE_ITEM_SPEC = objectShape(
  {
    type: enumOf(["string", "integer", "boolean", "null", "array", "object"]),
  },
  {
    revalue: REVALUE_SPEC,
    value: ANY,
  },
  {
    rules: [
      forbidKeyWhenPresent("value", "revalue", {
        message: 'Table item cannot define both "value" and "revalue".',
      }),
    ],
  },
);

const LIST_STYLE_SPEC = objectShape(
  {
    style: enumOf(["repeat", "delimited", "bracket", "json"]),
  },
  {
    delimiter: STRINGISH,
    indexed: BOOLEAN,
  },
);

const HUMANIZE_ACTION_SPEC = objectShape(
  {
    from: integerAtLeast(0),
    to: integerAtLeast(0),
  },
  {},
  {
    rules: [
      requireKeyOrder("from", "to", {
        message: 'Expected key "to" to be greater than or equal to key "from" in "humanize_action".',
      }),
    ],
  },
);

const URL_PARAM_VALUE_SPEC = objectShape(
  {
    value_in_url: STRINGISH,
  },
  {
    value: ANY,
    default: BOOLEAN,
  },
  {
    rules: [
      requireKeyUnlessBooleanTrue("value", "default", {
        code: "missing-url-param-value",
        message: 'Expected key "value" unless "default=true" is present.',
      }),
    ],
  },
);

const BROWSER_SPEC = enumOf(["chromium", "firefox", "webkit", "camoufox"]);
const TRANSPORT_SPEC = enumOf(["direct", "fetch", "goto"]);
const METHOD_SPEC = enumOf(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const GROUP_REFERENCE_SPEC = referenceOf(["GROUPS"]);
const CORS_MODE_SPEC = enumOf(["cors", "no-cors", "same-origin"]);
const CREDENTIALS_SPEC = enumOf(["omit", "same-origin", "include"]);
const APP_NAME_SPEC = patternOf(/^\S+$/, "string without spaces");
const AUTHOR_EMAIL_SPEC = patternOf(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "email address");
const LICENSE_SPEC = patternOf(/^[A-Za-z0-9][A-Za-z0-9.+-]*$/, "license abbreviation");
const AUTHOR_ITEM_SPEC = objectShape(
  {
    name: STRING,
    email: AUTHOR_EMAIL_SPEC,
  },
);
const HUMANIZE_SPEC = oneOf(BOOLEAN, numberGreaterThan(0));
const REGEX_ACTION_ITEM_SPEC = objectShape(
  {
    action: enumOf(["lower", "upper", "capitalize", "trim", "replace"]),
  },
  {
    what: STRINGISH,
    with: STRINGISH,
  },
  {
    rules: [
      requireKeyWhenValue("what", "action", ["replace"], {
        valueSpec: STRINGISH,
        message: 'Expected key "what" when action="replace".',
      }),
      requireKeyWhenValue("with", "action", ["replace"], {
        valueSpec: STRINGISH,
        message: 'Expected key "with" when action="replace".',
      }),
    ],
  },
);

const PIPELINE_WAIT_ELEMENT_STATE_SPEC = enumOf(["visible", "hidden", "attached", "detached"]);
const PIPELINE_WAIT_NETWORK_STATE_SPEC = enumOf(["load", "domcontentloaded", "networkidle", "commit"]);
const PIPELINE_THEN_ACTION_SPEC = enumOf(["click", "commit"]);
const PIPELINE_THEN_OBJECT_SPEC = objectShape(
  {
    action: PIPELINE_THEN_ACTION_SPEC,
  },
  {
    what: ANY,
    timeout_ms: integerAtLeast(0),
  },
);
const PIPELINE_THEN_SPEC = oneOf(PIPELINE_THEN_ACTION_SPEC, PIPELINE_THEN_OBJECT_SPEC);
const PIPELINE_IF_ELEMENT_SPEC = objectShape(
  {
    action: enumOf(["element", "wait_element"]),
  },
  {
    state: PIPELINE_WAIT_ELEMENT_STATE_SPEC,
    what: ANY,
  },
);
const PIPELINE_IF_NETWORK_SPEC = objectShape(
  {
    action: enumOf(["wait_network"]),
  },
  {
    state: PIPELINE_WAIT_NETWORK_STATE_SPEC,
  },
);
const PIPELINE_IF_SPEC = oneOf(PIPELINE_IF_ELEMENT_SPEC, PIPELINE_IF_NETWORK_SPEC);
const PIPELINE_WAIT_SNIFFER_SPEC = objectShape(
  {
    action: enumOf(["wait_sniffer"]),
    what: ANY,
  },
  {
    raise: STRINGISH,
    timeout_ms: integerAtLeast(0),
    for_tests: BOOLEAN,
  },
);
const PIPELINE_WAIT_ELEMENT_SPEC = objectShape(
  {
    action: enumOf(["wait_element", "element"]),
    state: PIPELINE_WAIT_ELEMENT_STATE_SPEC,
    what: ANY,
  },
  {
    then: PIPELINE_THEN_SPEC,
    raise: STRINGISH,
    timeout_ms: integerAtLeast(0),
    for_tests: BOOLEAN,
  },
);
const PIPELINE_WAIT_NETWORK_SPEC = objectShape(
  {
    action: enumOf(["wait_network"]),
    state: PIPELINE_WAIT_NETWORK_STATE_SPEC,
  },
  {
    raise: STRINGISH,
    timeout_ms: integerAtLeast(0),
    for_tests: BOOLEAN,
  },
);
const PIPELINE_ALWAYS_SPEC = objectShape(
  {
    action: enumOf(["always"]),
    if: PIPELINE_IF_SPEC,
    then: PIPELINE_THEN_SPEC,
  },
  {
    raise: STRINGISH,
    timeout_ms: integerAtLeast(0),
    for_tests: BOOLEAN,
  },
);
const PIPELINE_CONCURRENT_ITEM_SPEC = oneOf(PIPELINE_WAIT_SNIFFER_SPEC, PIPELINE_WAIT_ELEMENT_SPEC, PIPELINE_WAIT_NETWORK_SPEC);
const PIPELINE_ITEM_SPEC = oneOf(
  PIPELINE_CONCURRENT_ITEM_SPEC,
  arrayOf(PIPELINE_CONCURRENT_ITEM_SPEC),
  PIPELINE_ALWAYS_SPEC,
);

const POSTPROCESS_TABLE_KEYS = {
  render_html: BOOLEAN,
  goto_pipeline: arrayOf(PIPELINE_ITEM_SPEC),
  evaluate: STRINGISH,
};

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
    name: APP_NAME_SPEC,
    authors: arrayOf(AUTHOR_ITEM_SPEC),
    description: STRING,
    license: LICENSE_SPEC,
    version: STRINGISH,
    timeout_ms: integerAtLeast(0),
    class_name_pattern: CLASS_NAME_PATTERN_SPEC,
    browser: BROWSER_SPEC,
  }),
  makeFixedSchema(exactPath(["app", "warmup"]), {
    humanize: HUMANIZE_SPEC,
    block_images: BOOLEAN,
    humanize_action: HUMANIZE_ACTION_SPEC,
    url: ANY,
    pipeline: arrayOf(PIPELINE_ITEM_SPEC),
    headers_sniffer: BOOLEAN,
    error_selector: STRINGISH,
    on_error_screenshot_path: SCREENSHOT_PATH_SPEC,
    timeout_ms: integerAtLeast(0),
  }),
  makeFixedSchema(exactPath(["app", "variables", "*"]), {
    types: arrayOf(VARIABLE_TYPE_ITEM_SPEC),
    description: STRINGISH,
    read_only: BOOLEAN,
    from: ANY,
  }),
  makeDynamicSchema(exactPath(["app", "prefixes"]), STRINGISH, {
    keyDescription: "prefix",
  }),
  makeFixedSchema(exactPath(["app", "regexes", "*"]), {
    regex: STRINGISH,
    actions: arrayOf(REGEX_ACTION_ITEM_SPEC),
    raise: STRINGISH,
    description: STRINGISH,
  }),
  makeFixedSchema(matchesGroupPath, {
    description: STRINGISH,
  }),
  makeFixedSchema(matchesFuncHeadersPath, {
    referrer: ANY,
    cors_mode: CORS_MODE_SPEC,
    credentials: CREDENTIALS_SPEC,
    headers: ANY,
  }),
  makeFixedSchema(exactPath(["app", "func", "*"]), {
    name: STRINGISH,
    transport: TRANSPORT_SPEC,
    method: METHOD_SPEC,
    group: GROUP_REFERENCE_SPEC,
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
    revalue: REVALUE_SPEC,
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
    base: STRINGISH,
  }),
  makeFixedSchema(matchesUrlPath, {
    base: STRINGISH,
  }),
  makeFixedSchema(exactPath(["app", "func", "*", "postprocess"]), POSTPROCESS_TABLE_KEYS),
  makeFixedSchema(matchesUrlParamsPath, {
    sub_url: BOOLEAN,
    required: BOOLEAN,
    list: BOOLEAN,
    list_style: LIST_STYLE_SPEC,
    values: arrayOf(URL_PARAM_VALUE_SPEC),
    description: STRINGISH,
    data: ANY,
    revalue: REVALUE_SPEC,
  }),
  makeFixedSchema(exactPath(["app", "func", "*", "examples"]), {
    examples: arrayOf(EXAMPLE_ITEM_SPEC),
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
  const valueDiagnostics = collectValueDiagnostics(assignment.value, spec, assignment.valueRange);
  if (valueDiagnostics.length === 0) {
    return [];
  }
  return valueDiagnostics;
}

function findSchema(tablePath) {
  for (const schema of TABLE_SCHEMAS) {
    if (schema.match(tablePath)) {
      return schema;
    }
  }
  return null;
}

function validateValueSpec(value, spec, context = null) {
  const diagnostics = collectValueDiagnostics(value, spec, context && context.range ? context.range : null);
  return diagnostics.length ? diagnostics[0].message : null;
}

function collectValueDiagnostics(value, spec, fallbackRange = null) {
  if (spec.kind === "any") {
    return [];
  }
  if (spec.kind === "oneOf") {
    for (const option of spec.options) {
      if (collectValueDiagnostics(value, option, fallbackRange).length === 0) {
        return [];
      }
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected one of: ${spec.options.map(describeSpec).join(", ")}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "input-list-type") {
    if (isBareListTypeValue(value, spec.valueSpec)) {
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "arrayOf") {
    if (!(value instanceof ArrayExpr)) {
      return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
    }
    const diagnostics = [];
    for (const item of value.items) {
      diagnostics.push(...collectValueDiagnostics(item, spec.item, item.range));
    }
    return diagnostics;
  }
  if (spec.kind === "recordOf") {
    if (!(value instanceof InlineTableExpr)) {
      return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
    }
    const diagnostics = [];
    for (const entry of value.items) {
      diagnostics.push(...collectValueDiagnostics(entry.value, spec.valueSpec, entry.value.range));
    }
    return diagnostics;
  }
  if (spec.kind === "objectShape") {
    if (!(value instanceof InlineTableExpr)) {
      return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
    }
    const diagnostics = [];
    const required = new Map(Object.entries(spec.required || {}));
    const optional = new Map(Object.entries(spec.optional || {}));
    const knownKeys = new Set([...required.keys(), ...optional.keys()]);
    const seenKeys = new Set();
    const entriesByKey = new Map();
    for (const entry of value.items) {
      if (seenKeys.has(entry.key)) {
        diagnostics.push(typeDiagnostic(entry.keyRange, `Duplicate key "${entry.key}" in ${describeSpec(spec)}.`, "duplicate-inline-table-key"));
        continue;
      }
      seenKeys.add(entry.key);
      entriesByKey.set(entry.key, entry);
      const entrySpec = required.get(entry.key) || optional.get(entry.key);
      if (!entrySpec) {
        if (!spec.allowUnknownKeys) {
          diagnostics.push(typeDiagnostic(entry.keyRange, `Unknown key "${entry.key}" in ${describeSpec(spec)}. Expected one of: ${[...knownKeys].join(", ")}.`, "unknown-inline-table-key"));
        }
        continue;
      }
      required.delete(entry.key);
      diagnostics.push(...collectValueDiagnostics(entry.value, entrySpec, entry.value.range));
    }
    for (const key of required.keys()) {
      diagnostics.push(typeDiagnostic(fallbackRange || value.range, `Missing required key "${key}" in ${describeSpec(spec)}.`, "missing-inline-table-key"));
    }
    for (const rule of spec.rules || []) {
      diagnostics.push(...evaluateObjectRule(rule, value, entriesByKey, fallbackRange || value.range));
    }
    return diagnostics;
  }
  if (spec.kind === "revalue") {
    if (value instanceof RefExpr) {
      return [];
    }
    if (value instanceof InlineTableExpr) {
      const diagnostics = collectValueDiagnostics(value, NUMERIC_RANGE_SPEC, fallbackRange);
      if (diagnostics.length > 0) {
        const keys = new Set(value.items.map((entry) => entry.key));
        if (keys.has("regex")) {
          return [typeDiagnostic(fallbackRange || value.range, `Expected reference <...> or numeric range inline table for revalue but got ${describeValue(value)}`, "invalid-assignment-value-type")];
        }
      }
      return diagnostics;
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected reference <...> or numeric range inline table for revalue but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "enum") {
    if (value instanceof StringExpr && value.quoted === false && spec.values.includes(value.value)) {
      return [];
    }
    if (value instanceof IdentExpr && spec.values.includes(value.name)) {
      return [];
    }
    if (value instanceof NullExpr && spec.values.includes("null")) {
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "reference") {
    if (!(value instanceof RefExpr)) {
      return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
    }
    const path = referencePathSegments(value);
    if (!path.length || (spec.roots && spec.roots.length && !spec.roots.includes(path[0]))) {
      return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
    }
    return [];
  }
  if (spec.kind === "stringish") {
    if ((value instanceof StringExpr && value.quoted !== false) || value instanceof SequenceExpr || value instanceof MergeExpr || value instanceof RefExpr) {
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "pattern") {
    if (value instanceof StringExpr && value.quoted !== false && spec.pattern.test(value.value)) {
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "string") {
    if (value instanceof StringExpr && value.quoted !== false) {
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "boolean") {
    if (value instanceof BoolExpr) {
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "integer") {
    if (value instanceof NumberExpr && Number.isInteger(value.value) && !/[.eE]/.test(value.raw)) {
      if ((spec.min != null && value.value < spec.min) || (spec.max != null && value.value > spec.max)) {
        const actual = typeof value.raw === "string" ? value.raw : describeValue(value);
        return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${actual}`, "invalid-assignment-value-type")];
      }
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "number") {
    if (value instanceof NumberExpr && Number.isFinite(value.value)) {
      const belowMin = spec.min != null && (spec.exclusiveMin ? value.value <= spec.min : value.value < spec.min);
      const aboveMax = spec.max != null && (spec.exclusiveMax ? value.value >= spec.max : value.value > spec.max);
      if (belowMin || aboveMax) {
        const actual = typeof value.raw === "string" ? value.raw : describeValue(value);
        return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${actual}`, "invalid-assignment-value-type")];
      }
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "array") {
    if (value instanceof ArrayExpr) {
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "object") {
    if (value instanceof InlineTableExpr) {
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "null") {
    if (value instanceof NullExpr) {
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  return [];
}

function evaluateObjectRule(rule, value, entriesByKey, fallbackRange) {
  if (rule.kind === "requireKeyUnlessBooleanTrue") {
    const requiredEntry = entriesByKey.get(rule.requiredKey);
    if (requiredEntry) {
      return [];
    }
    const triggerEntry = entriesByKey.get(rule.triggerKey);
    if (triggerEntry && triggerEntry.value instanceof BoolExpr && triggerEntry.value.value === true) {
      return [];
    }
    return [
      typeDiagnostic(
        fallbackRange,
        rule.message,
        rule.code,
      ),
    ];
  }
  if (rule.kind === "requireKeyWhenValue") {
    const triggerEntry = entriesByKey.get(rule.triggerKey);
    if (!triggerEntry || !isBareEnumValue(triggerEntry.value)) {
      return [];
    }
    if (!rule.triggerValues.includes(triggerEntry.value.value)) {
      return [];
    }
    const requiredEntry = entriesByKey.get(rule.requiredKey);
    if (!requiredEntry) {
      return [
        typeDiagnostic(
          fallbackRange,
          rule.message,
          rule.code,
        ),
      ];
    }
    if (!rule.valueSpec) {
      return [];
    }
    return collectValueDiagnostics(requiredEntry.value, rule.valueSpec, requiredEntry.value.range);
  }
  if (rule.kind === "requireKeyOrder") {
    const lowerEntry = entriesByKey.get(rule.lowerKey);
    const upperEntry = entriesByKey.get(rule.upperKey);
    if (!lowerEntry || !upperEntry) {
      return [];
    }
    const lowerValue = getNumericLiteral(lowerEntry.value);
    const upperValue = getNumericLiteral(upperEntry.value);
    if (lowerValue === null || upperValue === null) {
      return [];
    }
    if (upperValue < lowerValue) {
      return [
        typeDiagnostic(
          upperEntry.value.range || upperEntry.keyRange || fallbackRange,
          rule.message,
          rule.code,
        ),
      ];
    }
    return [];
  }
  if (rule.kind === "forbidKeyWhenValue") {
    const triggerEntry = entriesByKey.get(rule.triggerKey);
    if (!triggerEntry || !isBareEnumValue(triggerEntry.value)) {
      return [];
    }
    if (!rule.triggerValues.includes(triggerEntry.value.value)) {
      return [];
    }
    const forbiddenEntry = entriesByKey.get(rule.forbiddenKey);
    if (!forbiddenEntry) {
      return [];
    }
    return [
      typeDiagnostic(
        forbiddenEntry.keyRange || fallbackRange,
        rule.message,
        rule.code,
      ),
    ];
  }
  if (rule.kind === "forbidKeyWhenPresent") {
    const triggerEntry = entriesByKey.get(rule.triggerKey);
    if (!triggerEntry) {
      return [];
    }
    const forbiddenEntry = entriesByKey.get(rule.forbiddenKey);
    if (!forbiddenEntry) {
      return [];
    }
    return [
      typeDiagnostic(
        forbiddenEntry.keyRange || fallbackRange,
        rule.message,
        rule.code,
      ),
    ];
  }
  return [];
}

function getNumericLiteral(value) {
  if (value instanceof NumberExpr && Number.isFinite(value.value)) {
    return value.value;
  }
  return null;
}

function isBareListTypeValue(value, itemSpec) {
  if (!(value instanceof SequenceExpr) || value.items.length !== 2) {
    return false;
  }
  const [prefix, suffix] = value.items;
  if (!isBareListTypePrefix(prefix)) {
    return false;
  }
  if (!(suffix instanceof ArrayExpr) || suffix.items.length !== 1) {
    return false;
  }
  return collectValueDiagnostics(suffix.items[0], itemSpec, suffix.items[0].range).length === 0;
}

function isBareListTypePrefix(value) {
  if (value instanceof StringExpr) {
    return value.quoted === false && value.value === "list";
  }
  if (value instanceof IdentExpr) {
    return value.name === "list";
  }
  return false;
}

function describeSpec(spec) {
  if (spec.kind === "integer") {
    if (spec.min != null && spec.max != null) {
      if (spec.min === spec.max) {
        return `integer equal to ${spec.min}`;
      }
      return `integer between ${spec.min} and ${spec.max}`;
    }
    if (spec.min != null) {
      if (spec.min === 0) {
        return "non-negative integer";
      }
      return `integer >= ${spec.min}`;
    }
    if (spec.max != null) {
      return `integer <= ${spec.max}`;
    }
    return "integer";
  }
  if (spec.kind === "number") {
    if (spec.min != null && spec.max != null) {
      if (spec.min === spec.max) {
        if (spec.exclusiveMin || spec.exclusiveMax) {
          return `number > ${spec.min} and < ${spec.max}`;
        }
        return `number between ${spec.min} and ${spec.max}`;
      }
      const lower = spec.exclusiveMin ? `> ${spec.min}` : `>= ${spec.min}`;
      const upper = spec.exclusiveMax ? `< ${spec.max}` : `<= ${spec.max}`;
      return `number ${lower} and ${upper}`;
    }
    if (spec.min != null) {
      return spec.exclusiveMin ? `number > ${spec.min}` : `number >= ${spec.min}`;
    }
    if (spec.max != null) {
      return spec.exclusiveMax ? `number < ${spec.max}` : `number <= ${spec.max}`;
    }
    return "number";
  }
  if (spec.kind === "oneOf") {
    return spec.options.map(describeSpec).join(" or ");
  }
  if (spec.kind === "input-list-type") {
    return "list[type]";
  }
  if (spec.kind === "arrayOf") {
    return `array of ${describeSpec(spec.item)}`;
  }
  if (spec.kind === "recordOf") {
    return `inline table with arbitrary keys and ${describeSpec(spec.valueSpec)} values`;
  }
  if (spec.kind === "objectShape") {
    const required = Object.keys(spec.required || {});
    const optional = Object.keys(spec.optional || {});
    const parts = [];
    if (required.length) {
      parts.push(`required keys ${required.join(", ")}`);
    }
    if (optional.length) {
      parts.push(`optional keys ${optional.join(", ")}`);
    }
    if (!parts.length) {
      return "inline table";
    }
    return `inline table with ${parts.join(" and ")}`;
  }
  if (spec.kind === "revalue") {
    return "reference <...> or numeric range inline table";
  }
  if (spec.kind === "enum") {
    return `one of ${spec.values.map((value) => JSON.stringify(value)).join(", ")}`;
  }
  if (spec.kind === "reference") {
    if (Array.isArray(spec.roots) && spec.roots.length) {
      return `reference <${spec.roots.map((root) => `${root}...`).join(" or ")}>`;
    }
    return "reference <...>";
  }
  if (spec.kind === "pattern") {
    return spec.description || `string matching ${spec.pattern}`;
  }
  return spec.kind;
}

function typeDiagnostic(range, message, code = "invalid-assignment-value-type") {
  return new Diagnostic(
    message,
    range || new Range(new Position(0, 0), new Position(0, 0)),
    "error",
    "msra",
    code,
  );
}

function describeValue(value) {
  if (value instanceof StringExpr) {
    return value.quoted === false ? "identifier" : "string";
  }
  if (value instanceof IdentExpr) {
    return "identifier";
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

function referencePathSegments(ref) {
  const path = [];
  for (const part of ref.parts || []) {
    if (part.kind !== "name") {
      break;
    }
    path.push(String(part.value));
  }
  return path;
}

function isBareEnumValue(value) {
  return (value instanceof StringExpr && value.quoted === false) || value instanceof IdentExpr;
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
  objectShape,
  recordOf,
  validateAssignment,
  validateValueSpec,
};
