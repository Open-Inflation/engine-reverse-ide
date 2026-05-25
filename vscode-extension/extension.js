const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const {
  LanguageClient,
  TransportKind,
} = require("vscode-languageclient/node");
const {
  SEMANTIC_TOKEN_MODIFIERS,
  SEMANTIC_TOKEN_TYPES,
  collectSemanticTokens,
} = require("./lsp/semantic-tokens");
const { parseDocument } = require("./lsp/parser");

let client;
let retokenizeScheduled = false;

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

function scheduleStartupRetokenize(context) {
  if (retokenizeScheduled) {
    return;
  }
  retokenizeScheduled = true;

  const tryRetokenize = async () => {
    const editors = vscode.window.visibleTextEditors.filter((editor) => editor.document.languageId === "msra");
    if (!editors.length) {
      return false;
    }
    try {
      await vscode.commands.executeCommand("editor.action.forceRetokenize");
      return true;
    } catch {
      return false;
    }
  };

  const delays = [0, 100, 250, 500, 1500];
  for (const delay of delays) {
    const timer = setTimeout(() => {
      void tryRetokenize();
    }, delay);
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
  }

  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => {
    void tryRetokenize();
  }));
}

function activate(context) {
  const server = resolveServer(context);
  if (!server) {
    return;
  }

  const semanticModifierIndex = new Map(SEMANTIC_TOKEN_MODIFIERS.map((modifier, index) => [modifier, index]));
  const semanticLegendWithModifiers = new vscode.SemanticTokensLegend(SEMANTIC_TOKEN_TYPES, SEMANTIC_TOKEN_MODIFIERS);
  const semanticProvider = vscode.languages.registerDocumentSemanticTokensProvider(
    { scheme: "file", language: "msra" },
    {
      provideDocumentSemanticTokens(document) {
        const parsed = parseDocument(document.getText(), document.uri.toString());
        const builder = new vscode.SemanticTokensBuilder(semanticLegendWithModifiers);
        for (const token of collectSemanticTokens(parsed)) {
          const tokenTypeIndex = SEMANTIC_TOKEN_TYPES.indexOf(token.tokenType);
          if (tokenTypeIndex < 0) {
            continue;
          }
          let tokenModifiers = 0;
          for (const modifier of token.tokenModifiers || []) {
            const modifierIndex = semanticModifierIndex.get(modifier);
            if (modifierIndex !== undefined) {
              tokenModifiers |= (1 << modifierIndex);
            }
          }
          builder.push(token.line, token.character, token.length, tokenTypeIndex, tokenModifiers);
        }
        return builder.build();
      },
    },
    semanticLegendWithModifiers,
  );
  context.subscriptions.push(semanticProvider);

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
      fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{msra,msraf}"),
    },
  };

  client = new LanguageClient(
    "msraLanguageServer",
    "MSRA Language Server",
    serverOptions,
    clientOptions,
  );

  context.subscriptions.push(client.start());
  scheduleStartupRetokenize(context);
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
