#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const { analyzeDocument } = require("./analysis");
const { parseDocument } = require("./parser");
const { main: runLanguageServer } = require("./server");

function usage() {
  return [
    "MSRA CLI",
    "",
    "Usage:",
    "  msra-lsp serve",
    "  msra-lsp check <file.msra>",
    "  msra-lsp check -",
    "  msra-lsp check <file.msra> --json",
    "",
    "The check command parses a .msra file and prints diagnostics from the same",
    "parser/analyzer that powers the VS Code LSP.",
    "",
  ].join("\n");
}

function readSource(filePath) {
  if (filePath === "-") {
    return fs.readFileSync(0, "utf8");
  }
  return fs.readFileSync(filePath, "utf8");
}

function toSeverityLabel(severity) {
  const value = String(severity || "error").toLowerCase();
  if (value === "warning" || value === "information" || value === "hint") {
    return value;
  }
  return "error";
}

function formatDiagnostic(fileUrl, diagnostic) {
  const start = diagnostic.range && diagnostic.range.start ? diagnostic.range.start : { line: 0, character: 0 };
  const code = diagnostic.code ? `[${diagnostic.code}]` : "";
  return `${fileUrl}:${start.line + 1}:${start.character + 1}: ${toSeverityLabel(diagnostic.severity)}${code ? code : ""}: ${diagnostic.message}`;
}

function runCheck(argv) {
  const args = [...argv];
  let json = false;
  const positional = [];
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      process.stdout.write(`${usage()}`);
      return 0;
    }
    positional.push(arg);
  }

  const filePath = positional[0];
  if (!filePath) {
    process.stderr.write(`${usage()}`);
    return 2;
  }

  try {
    const absolutePath = filePath === "-" ? "<stdin>" : path.resolve(filePath);
    const uri = filePath === "-" ? "stdin://msra" : pathToFileURL(absolutePath).href;
    const text = readSource(filePath);
    const document = parseDocument(text, uri);
    const analysis = analyzeDocument(document);
    const diagnostics = analysis.diagnostics.map((diagnostic) => ({
      message: diagnostic.message,
      severity: toSeverityLabel(diagnostic.severity),
      source: diagnostic.source,
      code: diagnostic.code,
      range: {
        start: {
          line: diagnostic.range.start.line,
          character: diagnostic.range.start.character,
        },
        end: {
          line: diagnostic.range.end.line,
          character: diagnostic.range.end.character,
        },
      },
    }));
    const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");

    if (json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            file: uri,
            diagnostics,
            hasErrors,
          },
          null,
          2,
        )}\n`,
      );
      return hasErrors ? 1 : 0;
    }

    if (!diagnostics.length) {
      process.stdout.write(`${absolutePath === "<stdin>" ? uri : absolutePath}: ok\n`);
    } else {
      for (const diagnostic of diagnostics) {
        process.stdout.write(`${formatDiagnostic(uri, diagnostic)}\n`);
      }
    }

    return hasErrors ? 1 : 0;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    process.stderr.write(`msra-lsp: ${message}\n`);
    return 2;
  }
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (!command || command === "serve" || command === "server" || command === "lsp") {
    runLanguageServer();
    return 0;
  }

  if (command === "check" || command === "diagnose") {
    return runCheck(rest);
  }

  if (command === "-h" || command === "--help") {
    process.stdout.write(`${usage()}`);
    return 0;
  }

  if (!command.startsWith("-")) {
    return runCheck(argv);
  }

  process.stderr.write(`${usage()}`);
  return 2;
}

if (require.main === module) {
  const exitCode = main();
  if (typeof exitCode === "number") {
    process.exitCode = exitCode;
  }
}

module.exports = {
  formatDiagnostic,
  main,
  runCheck,
  usage,
};
