const {
  ArrayExpr,
  BoolExpr,
  Diagnostic,
  CallExpr,
  InlineTableExpr,
  IdentExpr,
  MergeExpr,
  NumberExpr,
  RefExpr,
  SequenceExpr,
  StringExpr,
  pathLabel,
} = require("./model");
const { pathIdentityKey } = require("./path-schema");
const {
  ARRAY,
  BOOLEAN,
  INTEGER,
  NULL,
  OBJECT,
  STRING,
  arrayOf,
  oneOf,
  validateValueSpec,
} = require("./assignment-schema");

function validateAssignmentRelations(tableIndex, assignmentIndex) {
  const diagnostics = [];
  const assignmentsByTable = collectAssignmentsByTable(assignmentIndex);

  diagnostics.push(...validateValuesMatchConflicts(assignmentsByTable));
  diagnostics.push(...validateFuncTransportRelations(assignmentsByTable));
  diagnostics.push(...validateFuncPostprocessRelations(tableIndex, assignmentIndex));
  diagnostics.push(...validateWarmupRelations(assignmentIndex));
  diagnostics.push(...validateBodyRelations(tableIndex, assignmentIndex));
  diagnostics.push(...validateUrlParamValueRelations(assignmentsByTable));
  diagnostics.push(...validateExampleInputRelations(tableIndex, assignmentIndex, assignmentsByTable));
  diagnostics.push(...validateVariableSourceRelations(tableIndex, assignmentIndex));

  return diagnostics;
}

function collectAssignmentsByTable(assignmentIndex) {
  const assignmentsByTable = new Map();
  for (const assignment of assignmentIndex.values()) {
    const key = assignment.tableIdentityKey || pathIdentityKey(assignment.tablePathSegments || assignment.tablePath);
    if (!assignmentsByTable.has(key)) {
      assignmentsByTable.set(key, []);
    }
    assignmentsByTable.get(key).push(assignment);
  }
  return assignmentsByTable;
}

function validateValuesMatchConflicts(assignmentsByTable) {
  const diagnostics = [];
  for (const assignments of assignmentsByTable.values()) {
    if (!assignments.length) {
      continue;
    }
    const tablePath = assignments[0].tablePath || [];
    if (!isValuesMatchTable(tablePath)) {
      continue;
    }
    const valuesAssignment = assignments.find((assignment) => assignment.key === "values");
    const matchAssignment = assignments.find((assignment) => assignment.key === "match");
    if (!valuesAssignment || !matchAssignment) {
      continue;
    }
    diagnostics.push(
      new Diagnostic(
        `Table [${pathLabel(tablePath)}] cannot define both "values" and "match".`,
        matchAssignment.keyRange || valuesAssignment.keyRange,
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
    const transport = getEnumAssignmentValueFromValue(transportAssignment && transportAssignment.value);
    if (transport === null) {
      continue;
    }
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
    const transport = getEnumAssignmentValue(assignmentIndex, funcPath, "transport");
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
  const appPath = ["app"];
  const browser = getEnumAssignmentValue(assignmentIndex, ["app"], "browser") || "camoufox";
  const browserIsCamoufox = browser === "camoufox";

  for (const key of ["humanize", "block_images"]) {
    const assignment = getAssignment(assignmentIndex, appPath, key);
    if (!assignment) {
      continue;
    }
    if (!browserIsCamoufox) {
      const label = key === "humanize" ? "@Humanize" : "@BlockImages";
      diagnostics.push(
        new Diagnostic(
          `App annotation "${label}" is only available when app.browser="camoufox".`,
          assignment.keyRange,
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
    const fromAssignment = getAssignment(assignmentIndex, tablePath, "from");
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

    if (!isMultipart && !fromAssignment && !(isFormEncoded && hasUrlChild)) {
      diagnostics.push(
        new Diagnostic(
          `Body item [${pathLabel(tablePath)}] requires "from" or a nested "url" table when type="${type}".`,
          getAssignment(assignmentIndex, tablePath, "type")?.keyRange || table.headerRange,
          "error",
          "msra",
          "missing-body-payload",
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
    if (!isValuesMatchTable(tablePath)) {
      continue;
    }

    const valuesAssignment = assignments.find((assignment) => assignment.key === "values");
    const listAssignment = assignments.find((assignment) => assignment.key === "list");
    const fromAssignment = assignments.find((assignment) => assignment.key === "from");
    const matchAssignment = assignments.find((assignment) => assignment.key === "match");

    if (
      tablePath[3] === "url" &&
      tablePath[4] === "params" &&
      listAssignment &&
      listAssignment.value instanceof BoolExpr &&
      listAssignment.value.value === true &&
      fromAssignment
    ) {
      diagnostics.push(...validateListUrlParamFromRelations(assignmentsByTable, tablePath, fromAssignment));
    }

    if (
      tablePath[3] === "url" &&
      tablePath[4] === "params" &&
      listAssignment &&
      listAssignment.value instanceof BoolExpr &&
      listAssignment.value.value === true &&
      fromAssignment &&
      !matchAssignment &&
      !hasSelectableUrlParamValues(valuesAssignment)
    ) {
      diagnostics.push(
        new Diagnostic(
          `URL parameter [${pathLabel(tablePath)}] with @List and from requires at least one selectable "value" entry in "values"; entries with only default=true are fallback choices and do not count. Use match instead if the parameter should accept arbitrary values.`,
          (valuesAssignment && valuesAssignment.keyRange) || fromAssignment.keyRange,
          "error",
          "msra",
          "missing-url-param-selectable-value",
        ),
      );
    }

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
            `Table [${pathLabel(tablePath)}] cannot define multiple default values in "values" unless @List is present.`,
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

function validateExampleInputRelations(tableIndex, assignmentIndex, assignmentsByTable) {
  const diagnostics = [];
  const availableInputsByFunction = collectInputsByFunction(tableIndex);

  for (const table of tableIndex.values()) {
    if (!isExampleItemTable(table.path || [])) {
      continue;
    }

    const functionPath = table.path.slice(0, 3);
    const availableInputs = availableInputsByFunction.get(functionPath[2]) || new Map();
    const inputsAssignment = getTableAssignment(assignmentsByTable, table.path, "inputs");
    if (!inputsAssignment) {
      diagnostics.push(
        new Diagnostic(
          `Missing required key "inputs" in table [${pathLabel(table.path)}].`,
          table.headerRange || table.pathRange || null,
          "error",
          "msra",
          "missing-inline-table-key",
        ),
      );
      continue;
    }

    if (!(inputsAssignment.value instanceof InlineTableExpr)) {
      continue;
    }

    for (const inputEntry of inputsAssignment.value.items) {
      if (!availableInputs.has(inputEntry.key)) {
        diagnostics.push(
          new Diagnostic(
            buildMissingExampleInputMessage(functionPath, table.path, inputEntry.key, availableInputs),
            inputEntry.keyRange,
            "error",
            "msra",
            "missing-example-input",
          ),
        );
        continue;
      }

      const typeAssignment = getTableAssignment(assignmentsByTable, [...functionPath, "input", inputEntry.key], "type");
      const expectedSpec = getExampleInputValueSpec(typeAssignment && typeAssignment.value);
      if (!expectedSpec) {
        continue;
      }

      if (isFuncResultReferenceValue(inputEntry.value)) {
        continue;
      }

      const message = validateValueSpec(inputEntry.value, expectedSpec, { range: inputEntry.value.range });
      if (message) {
        diagnostics.push(
          new Diagnostic(
            `Input "${inputEntry.key}" in table [${pathLabel(table.path)}] must match the declared type: ${message}.`,
            inputEntry.value.range || inputEntry.keyRange,
            "error",
            "msra",
            "invalid-example-input-type",
          ),
        );
      }
    }
  }

  return diagnostics;
}

function isFuncResultReferenceValue(value) {
  if (!(value instanceof RefExpr) || !Array.isArray(value.parts) || value.parts.length < 2) {
    return false;
  }
  const root = value.parts[0];
  return root && root.kind === "name" && String(root.value) === "FUNCRESULT";
}

function validateVariableSourceRelations(tableIndex, assignmentIndex) {
  const diagnostics = [];
  const variableNodes = new Map();

  for (const table of tableIndex.values()) {
    const tablePath = table.path || [];
    if (!isVariableTablePath(tablePath)) {
      continue;
    }

    const fromAssignment = getAssignment(assignmentIndex, tablePath, "from");
    if (!fromAssignment) {
      continue;
    }

    const tableKey = pathIdentityKey(tablePath);
    variableNodes.set(tableKey, {
      table,
      fromAssignment,
      deps: collectVariableDependencies(fromAssignment.value),
    });
  }

  const components = stronglyConnectedVariableComponents(variableNodes);
  for (const component of components) {
    if (!component.length) {
      continue;
    }

    if (component.length === 1) {
      const key = component[0];
      const node = variableNodes.get(key);
      if (!node || !node.deps.has(key)) {
        continue;
      }
      diagnostics.push(
        new Diagnostic(
          `Variable [${pathLabel(node.table.path)}] cannot reference itself in "from".`,
          node.fromAssignment.valueRange || node.fromAssignment.keyRange,
          "error",
          "msra",
          "self-referential-variable-source",
        ),
      );
      continue;
    }

    const labels = component
      .map((key) => pathLabel(variableNodes.get(key).table.path))
      .sort((left, right) => left.localeCompare(right));
    const message = `Circular variable source chain detected among: ${labels.join(", ")}.`;
    for (const key of component) {
      const node = variableNodes.get(key);
      diagnostics.push(
        new Diagnostic(
          message,
          node.fromAssignment.valueRange || node.fromAssignment.keyRange,
          "error",
          "msra",
          "circular-variable-source",
        ),
      );
    }
  }

  return diagnostics;
}

function stronglyConnectedVariableComponents(variableNodes) {
  const indexByKey = new Map();
  const lowLinkByKey = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let index = 0;

  function visit(key) {
    indexByKey.set(key, index);
    lowLinkByKey.set(key, index);
    index += 1;
    stack.push(key);
    onStack.add(key);

    const node = variableNodes.get(key);
    for (const dep of node.deps) {
      if (!variableNodes.has(dep)) {
        continue;
      }
      if (!indexByKey.has(dep)) {
        visit(dep);
        lowLinkByKey.set(key, Math.min(lowLinkByKey.get(key), lowLinkByKey.get(dep)));
        continue;
      }
      if (onStack.has(dep)) {
        lowLinkByKey.set(key, Math.min(lowLinkByKey.get(key), indexByKey.get(dep)));
      }
    }

    if (lowLinkByKey.get(key) !== indexByKey.get(key)) {
      return;
    }

    const component = [];
    while (stack.length) {
      const nodeKey = stack.pop();
      onStack.delete(nodeKey);
      component.push(nodeKey);
      if (nodeKey === key) {
        break;
      }
    }
    components.push(component);
  }

  for (const key of variableNodes.keys()) {
    if (!indexByKey.has(key)) {
      visit(key);
    }
  }

  return components;
}

function collectVariableDependencies(value) {
  const dependencies = new Set();
  walkExpressions(value, (node) => {
    if (!(node instanceof RefExpr)) {
      return;
    }
    const path = refPathSegments(node);
    if (path[0] !== "VARIABLES" || path.length < 2) {
      return;
    }
    dependencies.add(pathIdentityKey(["app", "variables", path[1]]));
  });
  return dependencies;
}

function isVariableTablePath(tablePath) {
  return tablePath.length === 3 && tablePath[0] === "app" && tablePath[1] === "variables";
}

function collectInputsByFunction(tableIndex) {
  const inputsByFunction = new Map();
  for (const table of tableIndex.values()) {
    const path = table.path || [];
    if (path.length !== 5 || path[0] !== "app" || path[1] !== "func" || path[3] !== "input") {
      continue;
    }

    const functionId = path[2];
    if (!inputsByFunction.has(functionId)) {
      inputsByFunction.set(functionId, new Map());
    }
    inputsByFunction.get(functionId).set(path[4], table);
  }
  return inputsByFunction;
}

function isExampleItemTable(tablePath) {
  return (
    tablePath.length === 5
    && tablePath[0] === "app"
    && tablePath[1] === "func"
    && tablePath[3] === "examples"
  );
}

function buildMissingExampleInputMessage(functionPath, examplePath, inputName, availableInputs) {
  const functionLabel = pathLabel(functionPath);
  const exampleLabel = pathLabel(examplePath);
  const inputNames = [...availableInputs.keys()].sort();

  if (!inputNames.length) {
    return `Input "${inputName}" in table [${exampleLabel}] does not exist. Function [${functionLabel}] does not define any inputs.`;
  }

  return `Input "${inputName}" in table [${exampleLabel}] does not exist. Expected one of: ${inputNames.join(", ")}.`;
}

function getExampleInputValueSpec(typeValue) {
  if (typeValue instanceof StringExpr && typeValue.quoted === false) {
    return primitiveInputTypeSpec(typeValue.value);
  }
  if (typeValue instanceof IdentExpr) {
    return primitiveInputTypeSpec(typeValue.name);
  }
  if (typeValue instanceof SequenceExpr && isBareListInputType(typeValue)) {
    const innerValue = typeValue.items[1].items[0];
    const innerSpec = getExampleInputValueSpec(innerValue);
    return innerSpec ? arrayOf(innerSpec) : null;
  }
  if (typeValue instanceof ArrayExpr) {
    if (!typeValue.items.length) {
      return ARRAY;
    }
    const itemSpecs = [];
    for (const item of typeValue.items) {
      const itemSpec = getExampleInputValueSpec(item);
      if (!itemSpec) {
        return null;
      }
      itemSpecs.push(itemSpec);
    }
    return arrayOf(itemSpecs.length === 1 ? itemSpecs[0] : oneOf(...itemSpecs));
  }
  return null;
}

function primitiveInputTypeSpec(typeName) {
  switch (typeName) {
    case "string":
      return STRING;
    case "integer":
      return INTEGER;
    case "boolean":
      return BOOLEAN;
    case "null":
      return NULL;
    case "array":
      return ARRAY;
    case "object":
      return OBJECT;
    default:
      return null;
  }
}

function isBareListInputType(value) {
  if (!(value instanceof SequenceExpr) || value.items.length !== 2) {
    return false;
  }
  const [prefix, suffix] = value.items;
  if (!isBareListPrefix(prefix)) {
    return false;
  }
  if (!(suffix instanceof ArrayExpr) || suffix.items.length !== 1) {
    return false;
  }
  return primitiveInputTypeSpec(getBareTypeName(suffix.items[0])) !== null;
}

function isBareListPrefix(value) {
  return (
    (value instanceof StringExpr && value.quoted === false && value.value === "list")
    || (value instanceof IdentExpr && value.name === "list")
  );
}

function getBareTypeName(value) {
  if (value instanceof StringExpr && value.quoted === false) {
    return value.value;
  }
  if (value instanceof IdentExpr) {
    return value.name;
  }
  return null;
}

function validateListUrlParamFromRelations(assignmentsByTable, tablePath, fromAssignment) {
  const diagnostics = [];
  const functionId = currentFunctionId(tablePath);
  if (!functionId) {
    return diagnostics;
  }

  for (const inputRef of collectInputRefs(fromAssignment.value)) {
    const inputName = inputRef.path[1];
    if (!inputName) {
      continue;
    }

    const inputPath = ["app", "func", functionId, "input", inputName];
    const typeAssignment = getTableAssignment(assignmentsByTable, inputPath, "type");
    if (typeAssignment && isListInputType(typeAssignment.value)) {
      continue;
    }

    diagnostics.push(
      new Diagnostic(
        `URL parameter [${pathLabel(tablePath)}] with @List requires from to reference INPUT.${inputName} as a list type (${pathLabel(inputPath)}).`,
        inputRef.range,
        "error",
        "msra",
        "invalid-url-param-list-input-type",
      ),
    );
    break;
  }

  return diagnostics;
}

function collectInputRefs(expr) {
  const refs = [];
  walkExpressions(expr, (node) => {
    if (!(node instanceof RefExpr)) {
      return;
    }
    const path = refPathSegments(node);
    if (path[0] === "INPUT" && path.length >= 2) {
      refs.push({ path, range: node.range });
    }
  });
  return refs;
}

function hasSelectableUrlParamValues(valuesAssignment) {
  if (!valuesAssignment || !(valuesAssignment.value instanceof ArrayExpr)) {
    return false;
  }

  for (const item of valuesAssignment.value.items) {
    if (!(item instanceof InlineTableExpr)) {
      continue;
    }
    if (item.items.some((entry) => entry.key === "value")) {
      return true;
    }
  }

  return false;
}

function walkExpressions(expr, visitor) {
  if (!expr) {
    return;
  }

  visitor(expr);

  if (expr instanceof ArrayExpr) {
    for (const item of expr.items) {
      walkExpressions(item, visitor);
    }
    return;
  }

  if (expr instanceof InlineTableExpr) {
    for (const entry of expr.items) {
      walkExpressions(entry.value, visitor);
    }
    return;
  }

  if (expr instanceof SequenceExpr || expr instanceof MergeExpr) {
    const parts = expr.parts || expr.items || [];
    for (const part of parts) {
      walkExpressions(part, visitor);
    }
    return;
  }

  if (expr instanceof CallExpr) {
    for (const arg of expr.args) {
      walkExpressions(arg.value, visitor);
    }
    return;
  }

  if (expr instanceof RefExpr) {
    for (const part of expr.parts) {
      if (part.kind === "index") {
        walkExpressions(part.value, visitor);
      } else if (part.kind === "call") {
        for (const arg of part.value || []) {
          walkExpressions(arg.value, visitor);
        }
      }
    }
  }
}

function refPathSegments(ref) {
  const path = [];
  for (const part of ref.parts) {
    if (part.kind !== "name") {
      break;
    }
    path.push(String(part.value));
  }
  return path;
}

function currentFunctionId(tablePath) {
  const segments = [...tablePath];
  for (let index = 0; index < segments.length - 2; index += 1) {
    if (segments[index] === "app" && segments[index + 1] === "func") {
      return segments[index + 2];
    }
  }
  return null;
}

function getTableAssignment(assignmentsByTable, tablePath, key) {
  const assignments = assignmentsByTable.get(pathIdentityKey(tablePath));
  if (!assignments) {
    return null;
  }
  return assignments.find((assignment) => assignment.key === key) || null;
}

function isListInputType(value) {
  if (!(value instanceof SequenceExpr) || value.items.length !== 2) {
    return false;
  }
  const [prefix, suffix] = value.items;
  if (!(prefix instanceof StringExpr) || prefix.quoted !== false || prefix.value !== "list") {
    return false;
  }
  if (!(suffix instanceof ArrayExpr) || suffix.items.length !== 1) {
    return false;
  }
  const inner = suffix.items[0];
  if (inner instanceof StringExpr) {
    return inner.quoted === false && isPrimitiveInputTypeName(inner.value);
  }
  if (inner instanceof IdentExpr) {
    return isPrimitiveInputTypeName(inner.name);
  }
  return false;
}

function isPrimitiveInputTypeName(typeName) {
  return typeof typeName === "string" && ["string", "integer", "boolean", "null", "array", "object"].includes(typeName.trim());
}

function getAssignment(assignmentIndex, tablePath, key) {
  const tableKey = pathIdentityKey(tablePath);
  return assignmentIndex.get(JSON.stringify([tableKey, String(key)])) || null;
}

function getStringAssignmentValue(assignmentIndex, tablePath, key) {
  const assignment = getAssignment(assignmentIndex, tablePath, key);
  if (assignment && assignment.value instanceof StringExpr && assignment.value.quoted !== false) {
    return assignment.value.value;
  }
  return null;
}

function getEnumAssignmentValue(assignmentIndex, tablePath, key) {
  const assignment = getAssignment(assignmentIndex, tablePath, key);
  return getEnumAssignmentValueFromValue(assignment && assignment.value);
}

function getEnumAssignmentValueFromValue(value) {
  if (value instanceof StringExpr && value.quoted === false) {
    return value.value;
  }
  if (value instanceof IdentExpr) {
    return value.name;
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

function isValuesMatchTable(path) {
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
