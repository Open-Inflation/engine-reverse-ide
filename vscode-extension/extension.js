const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const {
  LanguageClient,
  TransportKind,
} = require("vscode-languageclient/node");

let client;

function getWorkspaceFolder() {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  return workspaceFolders.length > 0 ? workspaceFolders[0] : null;
}

function expandTemplate(value, context) {
  if (typeof value !== "string") {
    return value;
  }
  const workspaceFolder = getWorkspaceFolder();
  const workspacePath = workspaceFolder ? workspaceFolder.uri.fsPath : "";
  return value
    .replace(/\$\{workspaceFolder\}/g, workspacePath)
    .replace(/\$\{extensionPath\}/g, context.extensionPath);
}

function normalizeArgs(args, context) {
  if (!Array.isArray(args)) {
    return [];
  }
  return args.map((arg) => expandTemplate(String(arg), context));
}

function buildServerOptions(command, args) {
  const workspaceFolder = getWorkspaceFolder();
  const options = {
    cwd: workspaceFolder ? workspaceFolder.uri.fsPath : undefined,
    env: { ...process.env },
  };

  return {
    command,
    args,
    options,
  };
}

function resolveInternalServer(context) {
  const serverPath = context.asAbsolutePath(path.join("lsp", "server.js"));
  if (!fs.existsSync(serverPath)) {
    vscode.window.showErrorMessage(
      "MSRA Language Support could not find the bundled Node language server.",
    );
    return null;
  }

  return buildServerOptions(process.execPath, [serverPath]);
}

function resolveExternalServer(context) {
  const config = vscode.workspace.getConfiguration("msra");
  const command = expandTemplate(String(config.get("server.command") || "").trim(), context);
  if (!command) {
    vscode.window.showErrorMessage(
      "MSRA Language Support is in external mode, but msra.server.command is empty.",
    );
    return null;
  }

  const configuredArgs = config.get("server.args") || [];
  const args = normalizeArgs(configuredArgs, context);
  return buildServerOptions(command, args);
}

function resolveServer(context) {
  const config = vscode.workspace.getConfiguration("msra");
  const mode = String(config.get("server.mode") || "internal").toLowerCase();
  if (mode === "external") {
    return resolveExternalServer(context);
  }
  return resolveInternalServer(context);
}

function activate(context) {
  const server = resolveServer(context);
  if (!server) {
    return;
  }

  const serverOptions = {
    command: server.command,
    args: server.args,
    options: server.options,
    transport: TransportKind.stdio,
  };

  const clientOptions = {
    documentSelector: [
      { scheme: "file", language: "msra" },
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.msra"),
    },
  };

  client = new LanguageClient(
    "msraLanguageServer",
    "MSRA Language Server",
    serverOptions,
    clientOptions,
  );

  context.subscriptions.push(client.start());
}

function deactivate() {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

module.exports = {
  activate,
  deactivate,
};
