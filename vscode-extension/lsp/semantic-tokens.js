const {
  ArrayExpr,
  CallExpr,
  InlineTableExpr,
  MergeExpr,
  RefExpr,
  SequenceExpr,
} = require("./model");

const SEMANTIC_TOKEN_TYPES = [
  "namespace",
  "parameter",
  "property",
  "enumMember",
];

const SEMANTIC_TOKEN_MODIFIERS = [
  "msra",
];

const SYSTEM_SEGMENT_VALUES = new Set([
  "app",
  "misklerreverseapi",
  "warmup",
  "variables",
  "prefixes",
  "regexes",
  "groups",
  "func",
  "input",
  "body",
  "headers",
  "url",
  "params",
  "examples",
  "DOCUMENT",
  "PREFIXES",
  "REGEX",
  "REGEXES",
  "VARIABLES",
  "INPUT",
  "WARMUP",
  "UNSTANDART_HEADERS",
  "CAPTURED_URLS",
  "COOKIES",
  "LOCAL_STORAGE",
  "SESSION_STORAGE",
  "REQUEST",
  "RESPONSE",
  "SNIFF_RESPONSE",
]);

function collectSemanticTokens(document) {
  const tokens = [];

  const tables = [...document.tables.values()].sort(compareByStart);
  for (const table of tables) {
    for (const segment of table.pathSegments || []) {
      addToken(tokens, segment.range, classifySegment(segment), segment.quoted);
    }
  }

  const assignments = [...document.assignments.values()].sort(compareByStart);
  for (const assignment of assignments) {
    addToken(tokens, assignment.keyRange, classifyAssignmentKey(assignment), assignment.quoted);
    collectInlineTableTokens(assignment.value, tokens);
  }

  const references = [...document.references].sort(compareByStart);
  for (const reference of references) {
    for (const part of reference.expr.parts || []) {
      if (part.kind !== "name") {
        continue;
      }
      addToken(tokens, part.range, classifySegment(part), part.quoted);
    }
    collectInlineTableTokens(reference.expr, tokens);
  }

  tokens.sort(compareTokens);
  return dedupeTokens(tokens);
}

function collectInlineTableTokens(expr, tokens) {
  walkExpressions(expr, (node) => {
    if (node instanceof InlineTableExpr) {
      for (const entry of node.items) {
        addToken(tokens, entry.keyRange, "enumMember", entry.quoted);
        collectInlineTableTokens(entry.value, tokens);
      }
    }
  });
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
  if (expr instanceof SequenceExpr || expr instanceof MergeExpr) {
    for (const part of expr.parts) {
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

function classifySegment(segment) {
  if (!segment) {
    return null;
  }
  if (segment.quoted) {
    return "parameter";
  }
  return SYSTEM_SEGMENT_VALUES.has(String(segment.value)) ? "namespace" : "parameter";
}

function classifyAssignmentKey(assignment) {
  if (!assignment) {
    return null;
  }
  if (isCustomPrefixAssignment(assignment.tablePath)) {
    return "enumMember";
  }
  return "property";
}

function isCustomPrefixAssignment(tablePath) {
  return Array.isArray(tablePath) && tablePath.length === 2 && tablePath[0] === "app" && tablePath[1] === "prefixes";
}

function addToken(tokens, range, tokenType, quoted = false) {
  if (!range || !tokenType) {
    return;
  }
  const adjusted = quoted ? innerRange(range) : range;
  const start = adjusted.start || adjusted.begin || null;
  const end = adjusted.end || adjusted.finish || null;
  if (!start || !end) {
    return;
  }
  if (start.line !== end.line) {
    return;
  }
  const length = end.character - start.character;
  if (length <= 0) {
    return;
  }
  tokens.push({
    line: start.line,
    character: start.character,
    length,
    tokenType,
    tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
  });
}

function innerRange(range) {
  if (!range || !range.start || !range.end) {
    return range;
  }
  if (range.start.line !== range.end.line) {
    return range;
  }
  if (range.end.character - range.start.character <= 2) {
    return range;
  }
  return {
    start: {
      line: range.start.line,
      character: range.start.character + 1,
    },
    end: {
      line: range.end.line,
      character: range.end.character - 1,
    },
  };
}

function compareByStart(left, right) {
  return compareRanges(left.range || left.keyRange || left.headerRange, right.range || right.keyRange || right.headerRange);
}

function compareTokens(left, right) {
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  if (left.character !== right.character) {
    return left.character - right.character;
  }
  if (left.length !== right.length) {
    return left.length - right.length;
  }
  return left.tokenType.localeCompare(right.tokenType);
}

function compareRanges(left, right) {
  const leftStart = left && left.start ? left.start : { line: 0, character: 0 };
  const rightStart = right && right.start ? right.start : { line: 0, character: 0 };
  if (leftStart.line !== rightStart.line) {
    return leftStart.line - rightStart.line;
  }
  if (leftStart.character !== rightStart.character) {
    return leftStart.character - rightStart.character;
  }
  const leftEnd = left && left.end ? left.end : { line: 0, character: 0 };
  const rightEnd = right && right.end ? right.end : { line: 0, character: 0 };
  if (leftEnd.line !== rightEnd.line) {
    return leftEnd.line - rightEnd.line;
  }
  return leftEnd.character - rightEnd.character;
}

function dedupeTokens(tokens) {
  const seen = new Set();
  const deduped = [];
  for (const token of tokens) {
    const modifiers = Array.isArray(token.tokenModifiers) ? token.tokenModifiers.join(",") : "";
    const key = `${token.line}:${token.character}:${token.length}:${token.tokenType}:${modifiers}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(token);
  }
  return deduped;
}

module.exports = {
  SEMANTIC_TOKEN_TYPES,
  SEMANTIC_TOKEN_MODIFIERS,
  collectSemanticTokens,
  collectInlineTableTokens,
  classifySegment,
  classifyAssignmentKey,
  compareRanges,
};
