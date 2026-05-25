# MSRA

MSRA is a TOML-like language for describing browser automation and related runtime data.

## What this repo contains

- A VS Code extension for syntax highlighting, diagnostics, completion, hover, definitions, and semantic tokens.
- A shared Node-based parser, analyzer, and CLI entrypoint used by the editor integration and terminal checks.

## Documentation

MkDocs documentation lives under `docs/` and splits the MSRA language into separate pages per table family, so `[app]`, `[app.warmup]`, `[app.func.*]`, and related namespaces are documented independently.

- Main page: [`docs/index.md`](docs/index.md)
- Language overview: [`docs/msra-language.md`](docs/msra-language.md)
- App table: [`docs/msra-app.md`](docs/msra-app.md)
- Path rules: [`docs/msra-paths.md`](docs/msra-paths.md)

## CLI

The canonical installable CLI entrypoint is `msra-lsp`.

In this repository, the easiest way to run it is through the local Node wrapper:

```powershell
node .\bin\msra.js check .\examples\example.msra
node .\bin\msra.js serve
```

If you install or link the package, you can also call the bare command:

```powershell
msra-lsp check .\examples\example.msra
msra-lsp serve
```

If you prefer npm scripts:

```powershell
npm run check
npm run serve
```

If you are already inside `vscode-extension`, call the root entrypoint with a relative path:

```powershell
node ..\bin\msra.js check ..\examples\example.msra
```

## CLI modes

- `msra-lsp check <file.msra>` parses the file and prints diagnostics.
- `msra-lsp check <file.msra> --json` prints diagnostics as JSON.
- `msra-lsp check -` reads MSRA content from stdin.
- `msra-lsp serve` starts the language server over stdio for editors and external clients.

## Python Codegen

This repo also includes a Python generator that turns an `.msra` document into an async Python client package and a matching Sphinx documentation tree.

```powershell
python -m msra_codegen .\examples\fixprice\fixprice.msra -o .\generated
```

The generator uses Jinja2 templates, so install its Python dependency first if your environment does not already have it:

```powershell
python -m pip install -r .\msra_codegen\requirements.txt
```

The generator writes:

- `pyproject.toml`
- `<package-name>/__init__.py`
- `<package-name>/manager.py`
- `<package-name>/abstraction/__init__.py`
- `<package-name>/abstraction/regexes.py`
- `<package-name>/endpoints/*.py`
- referenced `extractors/*.js` assets
- `docs/requirements.txt`
- `docs/source/conf.py`
- `docs/source/index.rst`
- `docs/source/api.rst`
- `docs/source/<package-name>.rst`
- `docs/source/_api/*.rst`

To build the generated docs locally:

```powershell
python -m pip install -r .\generated\docs\requirements.txt
python -m sphinx -b html .\generated\docs\source .\generated\docs\_build\html
```

The reusable Jinja2 templates live under `msra_codegen/templates/`, so the output shape can be adjusted without editing the generator logic itself.

For the FixPrice project, the default package name is `fixprice_api`.

## Language overview

MSRA is TOML-like and supports object references such as `<OBJECT>` or `<OBJECT.value>`.

Available OBJECTS:

- `UNSTANDARD_HEADERS` (`.RESPONSE` or `.REQUEST` -> `{key: value}`)
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
