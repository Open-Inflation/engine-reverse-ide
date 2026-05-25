const {
  ArrayExpr,
  BoolExpr,
  Diagnostic,
  CallExpr,
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
const SCALAR = { kind: "scalar" };

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
  return path.length === 4 && path[0] === "app" && path[1] === "func" && path[3] === "headers";
}

function matchesDefaultsFuncHeadersPath(path) {
  return path.length === 4 && path[0] === "app" && path[1] === "defaults" && path[2] === "func" && path[3] === "headers";
}

function matchesExtractorPath(path) {
  return path.length === 4 && path[0] === "app" && path[1] === "func" && path[3] === "extractor";
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

function matchesWarmupPath(path) {
  return path.length === 2 && path[0] === "app" && path[1] === "warmup";
}

function matchesAppPath(path) {
  return path.length === 1 && path[0] === "app";
}

function matchesVariablesPath(path) {
  return path.length === 3 && path[0] === "app" && path[1] === "variables";
}

function matchesInputPath(path) {
  return path.length === 5 && path[0] === "app" && path[1] === "func" && path[3] === "input";
}

function matchesExampleItemPath(path) {
  return path.length === 5 && path[0] === "app" && path[1] === "func" && path[3] === "examples";
}

function annotationRequirementForAssignment(tablePath, key) {
  if (matchesAppPath(tablePath)) {
    if (key === "humanize") {
      return { kind: "humanize", label: "@Humanize", legacyLabel: "humanize" };
    }
    if (key === "block_images") {
      return { kind: "flag", label: "@BlockImages", legacyLabel: "block_images" };
    }
  }
  if (matchesWarmupPath(tablePath)) {
    if (key === "headers_sniffer") {
      return { kind: "flag", label: "@SniffHeaders", legacyLabel: "headers_sniffer" };
    }
  }
  if (matchesVariablesPath(tablePath) && key === "read_only") {
    return { kind: "flag", label: "@ReadOnly", legacyLabel: "read_only" };
  }
  if (matchesVariablesPath(tablePath) && key === "nullable") {
    return { kind: "flag", label: "@Nullable", legacyLabel: "nullable" };
  }
  if (matchesInputPath(tablePath) && key === "required") {
    return { kind: "flag", label: "@Required", legacyLabel: "required" };
  }
  if (matchesUrlParamsPath(tablePath)) {
    if (key === "sub_url") {
      return { kind: "flag", label: "@SubUrl", legacyLabel: "sub_url" };
    }
    if (key === "list") {
      return { kind: "flag", label: "@List", legacyLabel: "list" };
    }
  }
  if (matchesExampleItemPath(tablePath)) {
    if (key === "test") {
      return { kind: "flag", label: "@Test", legacyLabel: "test" };
    }
    if (key === "docs") {
      return { kind: "flag", label: "@Docs", legacyLabel: "docs" };
    }
  }
  if (matchesExtractorPath(tablePath) && key === "render_html") {
    return { kind: "flag", label: "@RenderHtml", legacyLabel: "render_html" };
  }
  return null;
}

function matchesBodyUrlPath(path) {
  return path.length >= 7 && path[0] === "app" && path[1] === "func" && path[3] === "body" && path[path.length - 1] === "url";
}

function makeFixedSchema(match, keys, options = {}) {
  return {
    match,
    allowUnknownKeys: Boolean(options.allowUnknownKeys),
    keys,
    rules: Array.isArray(options.rules) ? options.rules : [],
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
    inputs: EXAMPLE_INPUTS_SPEC,
  },
  {
    test: BOOLEAN,
    docs: BOOLEAN,
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

const MATCH_SPEC = { kind: "match" };
const VARIABLE_MATCH_SPEC = oneOf(MATCH_SPEC, arrayOf(SCALAR));
const CONST_SPEC = oneOf(STRING, arrayOf(STRING));
const JS_SCRIPT_PATH_SPEC = patternOf(
  /^(?:\.[\\/])?[A-Za-z0-9_.\/-]+\.js$/,
  "JavaScript extractor path like extractors/catalog-product-info.js",
);
const PY_SCRIPT_REFERENCE_SPEC = patternOf(
  /^(?:\.[\\/])?[A-Za-z_][A-Za-z0-9_]*\.py:[A-Za-z_][A-Za-z0-9_]*$/,
  "Python script reference like ./goto_pipeline.py:pipeline",
);

const VARIABLE_TYPE_ITEM_SPEC = objectShape(
  {
    type: enumOf(["string", "integer", "boolean", "array", "object"]),
  },
  {
    match: VARIABLE_MATCH_SPEC,
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
      forbidDynamicValue("value", {
        code: "invalid-url-param-value-dynamic",
        message: 'URL parameter value key "value" cannot be dynamic. References and other dynamic expressions are not allowed.',
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
      forbidDynamicValue("what", {
        code: "invalid-regex-action-what-dynamic",
        message: 'Regex action key "what" cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
      forbidDynamicValue("with", {
        code: "invalid-regex-action-with-dynamic",
        message: 'Regex action key "with" cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
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
  {
    rules: [
      forbidDynamicValue("what", {
        code: "invalid-pipeline-what-dynamic",
        message: 'Pipeline key "what" cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
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
  {
    rules: [
      forbidDynamicValue("what", {
        code: "invalid-pipeline-what-dynamic",
        message: 'Pipeline key "what" cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
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
    source: enumOf(["request", "response"]),
    what: ANY,
  },
  {
    raise: STRINGISH,
    timeout_ms: integerAtLeast(0),
    for_tests: BOOLEAN,
  },
  {
    rules: [
      forbidDynamicValue("what", {
        code: "invalid-pipeline-what-dynamic",
        message: 'Pipeline key "what" cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
      forbidDynamicValue("raise", {
        code: "invalid-pipeline-raise-dynamic",
        message: 'Pipeline key "raise" cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
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
  {
    rules: [
      forbidDynamicValue("what", {
        code: "invalid-pipeline-what-dynamic",
        message: 'Pipeline key "what" cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
      forbidDynamicValue("raise", {
        code: "invalid-pipeline-raise-dynamic",
        message: 'Pipeline key "raise" cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
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
  {
    rules: [
      forbidDynamicValue("raise", {
        code: "invalid-pipeline-raise-dynamic",
        message: 'Pipeline key "raise" cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
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
  {
    rules: [
      forbidDynamicValue("raise", {
        code: "invalid-pipeline-raise-dynamic",
        message: 'Pipeline key "raise" cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
  },
);
const PIPELINE_CONCURRENT_ITEM_SPEC = oneOf(PIPELINE_WAIT_SNIFFER_SPEC, PIPELINE_WAIT_ELEMENT_SPEC, PIPELINE_WAIT_NETWORK_SPEC);
const PIPELINE_ITEM_SPEC = oneOf(
  PIPELINE_CONCURRENT_ITEM_SPEC,
  arrayOf(PIPELINE_CONCURRENT_ITEM_SPEC),
  PIPELINE_ALWAYS_SPEC,
);

const EXTRACTOR_TABLE_KEYS = {
  render_html: BOOLEAN,
  script: JS_SCRIPT_PATH_SPEC,
  goto_pipeline: PY_SCRIPT_REFERENCE_SPEC,
};

const BODY_TYPE_SPEC = patternOf(
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?:\s*;\s*[^;]+)*$/i,
  "browser-supported MIME type",
);
const SCREENSHOT_PATH_SPEC = patternOf(
  /\.(?:jpe?g|png)$/i,
  "path ending in .jpg, .jpeg, or .png",
);
const WARMUP_SCRIPT_SPEC = patternOf(
  /^(?:\.[\\/])?[A-Za-z_][A-Za-z0-9_]*\.py:[A-Za-z_][A-Za-z0-9_]*$/,
  "Python script reference like ./warmup.py:pipeline",
);

const TABLE_SCHEMAS = [
  makeFixedSchema(exactPath(["msra"]), {
    version: STRINGISH,
  }, {
    rules: [
      forbidDynamicValue("version", {
        code: "invalid-version-dynamic",
        message: 'Version cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
  }),
  makeFixedSchema(exactPath(["app"]), {
    name: APP_NAME_SPEC,
    authors: arrayOf(AUTHOR_ITEM_SPEC),
    description: STRING,
    license: LICENSE_SPEC,
    version: STRINGISH,
    timeout_ms: integerAtLeast(0),
    browser: BROWSER_SPEC,
    humanize: HUMANIZE_SPEC,
    block_images: BOOLEAN,
  }, {
    rules: [
      forbidDynamicValue("version", {
        code: "invalid-version-dynamic",
        message: 'Version cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
  }),
  makeFixedSchema(exactPath(["app", "warmup"]), {
    warmup: WARMUP_SCRIPT_SPEC,
    headers_sniffer: BOOLEAN,
    on_error_screenshot_path: SCREENSHOT_PATH_SPEC,
    timeout_ms: integerAtLeast(0),
  }),
  makeFixedSchema(exactPath(["app", "variables", "*"]), {
    types: arrayOf(VARIABLE_TYPE_ITEM_SPEC),
    description: STRINGISH,
    read_only: BOOLEAN,
    nullable: BOOLEAN,
    from: ANY,
  }, {
    rules: [
      forbidDynamicValue("description", {
        code: "invalid-description-dynamic",
        message: 'Description cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
  }),
  makeDynamicSchema(exactPath(["app", "prefixes"]), STRINGISH, {
    keyDescription: "prefix",
  }),
  makeFixedSchema(exactPath(["app", "regexes", "*"]), {
    regex: STRINGISH,
    actions: arrayOf(REGEX_ACTION_ITEM_SPEC),
    raise: STRINGISH,
    description: STRINGISH,
  }, {
    rules: [
      forbidDynamicValue("raise", {
        code: "invalid-regex-raise-dynamic",
        message: 'Regex "raise" cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
      forbidDynamicValue("description", {
        code: "invalid-description-dynamic",
        message: 'Description cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
  }),
  makeFixedSchema(matchesGroupPath, {
    description: STRINGISH,
  }, {
    rules: [
      forbidDynamicValue("description", {
        code: "invalid-description-dynamic",
        message: 'Description cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
  }),
  makeFixedSchema(matchesDefaultsFuncHeadersPath, {
    referrer: ANY,
    cors_mode: CORS_MODE_SPEC,
    credentials: CREDENTIALS_SPEC,
    headers: ANY,
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
    description: STRINGISH,
  }, {
    rules: [
      forbidDynamicValue("name", {
        code: "invalid-function-name-dynamic",
        message: 'Function name cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
      forbidDynamicValue("description", {
        code: "invalid-description-dynamic",
        message: 'Description cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
  }),
  makeFixedSchema(exactPath(["app", "func", "*", "input", "*"]), {
    type: INPUT_TYPE_SPEC,
    description: STRINGISH,
    required: BOOLEAN,
    default: ANY,
    values: ARRAY,
    from: ANY,
    match: MATCH_SPEC,
  }, {
    rules: [
      forbidDynamicValue("description", {
        code: "invalid-description-dynamic",
        message: 'Description cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
  }),
  makeFixedSchema(matchesBodyPath, {
    type: BODY_TYPE_SPEC,
    charset: NULL_OR_STRING,
    boundary: STRINGISH,
    return_name: BOOLEAN,
    filename: ANY,
    from: ANY,
  }),
  makeFixedSchema(matchesBodyUrlPath, {
    base: STRINGISH,
  }),
  makeFixedSchema(matchesUrlPath, {
    base: STRINGISH,
  }),
  makeFixedSchema(exactPath(["app", "func", "*", "extractor"]), EXTRACTOR_TABLE_KEYS),
  makeFixedSchema(matchesUrlParamsPath, {
    sub_url: BOOLEAN,
    list: BOOLEAN,
    list_style: LIST_STYLE_SPEC,
    const: CONST_SPEC,
    values: arrayOf(URL_PARAM_VALUE_SPEC),
    description: STRINGISH,
    from: ANY,
    match: MATCH_SPEC,
  }, {
    rules: [
      forbidDynamicValue("description", {
        code: "invalid-description-dynamic",
        message: 'Description cannot be dynamic. References and other dynamic expressions are not allowed.',
      }),
    ],
  }),
  makeFixedSchema(exactPath(["app", "func", "*", "examples"]), {}),
  makeFixedSchema(exactPath(["app", "func", "*", "examples", "*"]), {
    inputs: EXAMPLE_INPUTS_SPEC,
    test: BOOLEAN,
    docs: BOOLEAN,
  }),
];

function validateAssignment(tablePath, assignment, tableAssignments = []) {
  const annotationRequirement = annotationRequirementForAssignment(tablePath, assignment.key);
  if (annotationRequirement) {
    if (!assignment.annotation) {
      const legacyTarget = annotationRequirement.kind === "humanize" ? '"humanize=..."' : `"${annotationRequirement.legacyLabel}=..."`;
      return [
        typeDiagnostic(
          assignment.keyRange,
          `Use ${annotationRequirement.label} instead of ${legacyTarget} in table [${pathLabel(tablePath)}].`,
          "annotation-required",
        ),
      ];
    }
    if (annotationRequirement.kind === "flag" && assignment.annotationHasArguments) {
      return [
        typeDiagnostic(
          assignment.keyRange,
          `Annotation ${annotationRequirement.label} does not accept arguments. Use bare ${annotationRequirement.label}.`,
          "invalid-annotation-argument",
        ),
      ];
    }
    if (annotationRequirement.kind === "humanize" && assignment.annotationHasArguments && !(assignment.value instanceof NumberExpr)) {
      return [
        typeDiagnostic(
          assignment.keyRange,
          "Annotation @Humanize accepts either bare form or a positive number argument.",
          "invalid-annotation-argument",
        ),
      ];
    }
  }
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
  if (valueDiagnostics.length > 0) {
    return valueDiagnostics;
  }
  const ruleDiagnostics = [];
  for (const rule of schema.rules || []) {
    ruleDiagnostics.push(...evaluateFixedSchemaRule(rule, assignment));
  }
  if (assignment.key === "const" && matchesUrlParamsPath(tablePath)) {
    ruleDiagnostics.push(...validateUrlParamConstConflicts(tableAssignments, assignment));
  }
  return ruleDiagnostics;
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

function collectValueDiagnostics(value, spec, fallbackRange = null, skipRules = false) {
  if (spec.kind === "any") {
    return [];
  }
  if (spec.kind === "oneOf") {
    for (const option of spec.options) {
      const structuralDiagnostics = collectValueDiagnostics(value, option, fallbackRange, true);
      if (structuralDiagnostics.length === 0) {
        if (skipRules) {
          return [];
        }
        const diagnostics = collectValueDiagnostics(value, option, fallbackRange, false);
        if (diagnostics.length === 0) {
          return [];
        }
        return diagnostics;
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
      diagnostics.push(...collectValueDiagnostics(item, spec.item, item.range, skipRules));
    }
    return diagnostics;
  }
  if (spec.kind === "recordOf") {
    if (!(value instanceof InlineTableExpr)) {
      return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
    }
    const diagnostics = [];
    for (const entry of value.items) {
      diagnostics.push(...collectValueDiagnostics(entry.value, spec.valueSpec, entry.value.range, skipRules));
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
      diagnostics.push(...collectValueDiagnostics(entry.value, entrySpec, entry.value.range, skipRules));
    }
    for (const key of required.keys()) {
      diagnostics.push(typeDiagnostic(fallbackRange || value.range, `Missing required key "${key}" in ${describeSpec(spec)}.`, "missing-inline-table-key"));
    }
    if (!skipRules) {
      for (const rule of spec.rules || []) {
        diagnostics.push(...evaluateObjectRule(rule, value, entriesByKey, fallbackRange || value.range));
      }
    }
    return diagnostics;
  }
  if (spec.kind === "match") {
    if (value instanceof RefExpr) {
      return [];
    }
    if (value instanceof InlineTableExpr) {
      const diagnostics = collectValueDiagnostics(value, NUMERIC_RANGE_SPEC, fallbackRange, skipRules);
      if (diagnostics.length > 0) {
        const keys = new Set(value.items.map((entry) => entry.key));
        if (keys.has("regex")) {
          return [typeDiagnostic(fallbackRange || value.range, `Expected reference <...> or numeric range inline table for match but got ${describeValue(value)}`, "invalid-assignment-value-type")];
        }
      }
      return diagnostics;
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected reference <...> or numeric range inline table for match but got ${describeValue(value)}`, "invalid-assignment-value-type")];
  }
  if (spec.kind === "scalar") {
    if (value instanceof StringExpr || value instanceof NumberExpr || value instanceof BoolExpr || value instanceof NullExpr) {
      return [];
    }
    return [typeDiagnostic(fallbackRange || value.range, `Expected ${describeSpec(spec)} but got ${describeValue(value)}`, "invalid-assignment-value-type")];
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
  if (rule.kind === "forbidDynamicValue") {
    const targetEntry = entriesByKey.get(rule.key);
    if (!targetEntry) {
      return [];
    }
    if (!containsDynamicValue(targetEntry.value)) {
      return [];
    }
    return [
      typeDiagnostic(
        targetEntry.value.range || targetEntry.keyRange || fallbackRange,
        rule.message,
        rule.code,
      ),
    ];
  }
  return [];
}

function evaluateFixedSchemaRule(rule, assignment) {
  if (rule.kind !== "forbidDynamicValue") {
    return [];
  }
  if (rule.key !== assignment.key) {
    return [];
  }
  if (!containsDynamicValue(assignment.value)) {
    return [];
  }
  return [
    typeDiagnostic(
      assignment.valueRange || assignment.keyRange,
      rule.message,
      rule.code,
    ),
  ];
}

function validateUrlParamConstConflicts(tableAssignments, assignment) {
  const conflicts = [];
  const conflictMessages = {
    from: 'URL parameter constant cannot define both "const" and "from". Use "const" for fixed parameters and "from" for values driven by inputs or references.',
    values: 'URL parameter constant cannot define both "const" and "values". Use "const" for fixed parameters and "values" for selectable mappings.',
    match: 'URL parameter constant cannot define both "const" and "match". Use "const" for fixed parameters and "match" for validation rules.',
  };
  for (const key of Object.keys(conflictMessages)) {
    const conflictingAssignment = tableAssignments.find((item) => item.key === key);
    if (!conflictingAssignment) {
      continue;
    }
    conflicts.push(
      typeDiagnostic(
        conflictingAssignment.keyRange || assignment.keyRange,
        conflictMessages[key],
        "conflicting-inline-table-keys",
      ),
    );
  }
  return conflicts;
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

function forbidDynamicValue(key, options = {}) {
  return {
    kind: "forbidDynamicValue",
    key,
    code: options.code || "invalid-inline-table-key-value",
    message: options.message || `Expected key "${key}" to be static.`,
  };
}

function containsDynamicValue(value) {
  if (value instanceof RefExpr || value instanceof SequenceExpr || value instanceof MergeExpr || value instanceof CallExpr) {
    return true;
  }
  if (value instanceof ArrayExpr) {
    return value.items.some((item) => containsDynamicValue(item));
  }
  if (value instanceof InlineTableExpr) {
    return value.items.some((entry) => containsDynamicValue(entry.value));
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
  if (spec.kind === "match") {
    return "reference <...> or numeric range inline table";
  }
  if (spec.kind === "scalar") {
    return "scalar value";
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
