const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const {
  LanguageClient,
  TransportKind
} = require("vscode-languageclient/node");

let client;

function resolveServerCommand(context) {
  const config = vscode.workspace.getConfiguration("msra");
  const command = config.get("server.command") || "python";
  const configuredArgs = config.get("server.args") || [];
  const args = Array.isArray(configuredArgs) ? configuredArgs.slice() : [];
  const options = {
    env: { ...process.env }
  };

  const workspaceFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (workspaceFolder) {
    const srcRoot = path.join(workspaceFolder.uri.fsPath, "src");
    const localPackage = path.join(srcRoot, "msra_lsp");
    if (fs.existsSync(localPackage)) {
      const existing = options.env.PYTHONPATH || "";
      options.env.PYTHONPATH = existing ? `${srcRoot}${path.delimiter}${existing}` : srcRoot;
    }
  }

  if (!options.env.PYTHONPATH) {
    const bundledPythonRoot = path.join(context.extensionPath, "python");
    const bundledPackage = path.join(bundledPythonRoot, "msra_lsp");
    if (fs.existsSync(bundledPackage)) {
      options.env.PYTHONPATH = bundledPythonRoot;
    }
  }

  if (args.length === 0) {
    args.push("-u", "-m", "msra_lsp", "server");
  }

  return { command, args, options };
}

function activate(context) {
  const server = resolveServerCommand(context);
  const serverOptions = {
    command: server.command,
    args: server.args,
    options: server.options,
    transport: TransportKind.stdio
  };

  const clientOptions = {
    documentSelector: [
      { scheme: "file", language: "msra" }
    ],
    synchronize: {
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.msra")
    }
  };

  client = new LanguageClient(
    "msraLanguageServer",
    "MSRA Language Server",
    serverOptions,
    clientOptions
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
  deactivate
};
