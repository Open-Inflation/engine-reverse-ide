#!/usr/bin/env node
const { main } = require("../vscode-extension/lsp/cli");

const exitCode = main(process.argv.slice(2));
if (typeof exitCode === "number") {
  process.exitCode = exitCode;
}
