# MSRA

MSRA is a TOML-like language for describing browser automation and related runtime data.

## What this repo contains

- A VS Code extension for syntax highlighting, diagnostics, completion, hover, definitions, and semantic tokens.
- A shared Node-based parser, analyzer, and CLI entrypoint used by the editor integration and terminal checks.

## CLI

The canonical installable CLI entrypoint is `msra-lsp`.

In this repository, the easiest way to run it is through the local Node wrapper:

```powershell
node .\bin\msra.js check .\example.msra
node .\bin\msra.js serve
```

If you install or link the package, you can also call the bare command:

```powershell
msra-lsp check .\example.msra
msra-lsp serve
```

If you prefer npm scripts:

```powershell
npm run check
npm run serve
```

If you are already inside `vscode-extension`, call the root entrypoint with a relative path:

```powershell
node ..\bin\msra.js check ..\example.msra
```

## CLI modes

- `msra-lsp check <file.msra>` parses the file and prints diagnostics.
- `msra-lsp check <file.msra> --json` prints diagnostics as JSON.
- `msra-lsp check -` reads MSRA content from stdin.
- `msra-lsp serve` starts the language server over stdio for editors and external clients.

## Language overview

MSRA is TOML-like and supports object references such as `<OBJECT>` or `<OBJECT.value>`.

Available OBJECTS:

- `UNSTANDART_HEADERS` (`.RESPONSE` or `.REQUEST` -> `{key: value}`)
- `CAPTURED_URLS` (`.RESPONSE` or `.REQUEST` -> array)
- `COOKIES` (for example `COOKIES["key"].VALUE["data"]`, when the string can be represented as a dictionary). Available fields also include `DOMAIN`, `PATH`, `EXPIRES`, `HTTP_ONLY`, `SECURE`, `SAME_SITE`.
- `LOCAL_STORAGE`
- `SESSION_STORAGE`

Both browser-side methods are supplemented by the sniffer during warmup.

- `INPUT` -> any data
- `VARIABLES` (`.any_key`) -> any data
- `DOCUMENT` (`.PREFIXES` or `.REGEXES`) -> any data, which allows access to other variables in TOML

Filters like `CAPTURED_URLS(START="http", TYPE=STR, END="something")` are also supported.

All OBJECTS are always available, but their contents depend on runtime context.
