const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function collectPythonFiles(dir) {
  const { readdirSync, statSync } = require("node:fs");
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...collectPythonFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".py")) {
      files.push(fullPath);
    }
  }
  return files;
}

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

function extractMarkdownCodeFence(text, language = "py") {
  const normalized = normalizeNewlines(text);
  const startToken = `\`\`\`${language}\n`;
  const start = normalized.indexOf(startToken);
  if (start === -1) {
    return null;
  }
  const end = normalized.indexOf("\n```", start + startToken.length);
  if (end === -1) {
    return null;
  }
  return normalized.slice(start + startToken.length, end);
}

function extractRstPythonCodeBlock(text) {
  const lines = normalizeNewlines(text).split("\n");
  const markerIndex = lines.findIndex((line) => line.trim() === ".. code-block:: python");
  if (markerIndex === -1) {
    return null;
  }
  let index = markerIndex + 1;
  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }
  const block = [];
  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("    ")) {
      block.push(line.slice(4));
      continue;
    }
    if (line.trim() === "") {
      const nextLine = lines[index + 1];
      if (nextLine != null && nextLine.startsWith("    ")) {
        block.push("");
        continue;
      }
    }
    break;
  }
  return block.join("\n");
}

function createPythonReleasesApiFixture(workDir) {
  const fixtureDir = path.join(workDir, "python-releases-fixture");
  mkdirSync(fixtureDir, { recursive: true });
  const fixturePath = path.join(fixtureDir, "python-releases.json");
  const fixtureJson = [
    { name: "Python 3.14.5" },
    { name: "Python 3.14.4" },
    { name: "Python 3.13.13" },
    { name: "Python 3.13.12" },
    { name: "Python 3.12.13" },
    { name: "Python 3.15.0a1" },
    { name: "Python 2.7.18" },
  ];
  writeFileSync(fixturePath, JSON.stringify(fixtureJson, null, 2), "utf8");
  const sitecustomizePath = path.join(fixtureDir, "sitecustomize.py");
  const sitecustomizeText = [
    "from __future__ import annotations",
    "",
    "from pathlib import Path",
    "from urllib.request import Request, urlopen as _urlopen",
    "",
    'TARGET_URL = "https://www.python.org/api/v2/downloads/release/"',
    'FIXTURE_PATH = Path(__file__).with_name("python-releases.json")',
    "",
    "class _FixtureResponse:",
    "    def __init__(self, text: str):",
    "        self._data = text.encode(\"utf-8\")",
    "",
    "    def read(self):",
    "        return self._data",
    "",
    "    def __enter__(self):",
    "        return self",
    "",
    "    def __exit__(self, exc_type, exc, tb):",
    "        return False",
    "",
    "def _patched_urlopen(url, *args, **kwargs):",
    "    target = url.full_url if isinstance(url, Request) else str(url)",
    "    if target == TARGET_URL:",
    "        return _FixtureResponse(FIXTURE_PATH.read_text(encoding=\"utf-8\"))",
    "    return _urlopen(url, *args, **kwargs)",
    "",
    "import urllib.request",
    "urllib.request.urlopen = _patched_urlopen",
    "",
  ].join("\n");
  writeFileSync(sitecustomizePath, sitecustomizeText, "utf8");
  return fixtureDir;
}

function buildCodegenPythonPath(pythonReleasesFixtureDir) {
  return {
    ...process.env,
    PYTHONPATH: pythonReleasesFixtureDir + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ""),
  };
}

function seedStaleOutput(outputDir) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "stale.txt"), "stale", "utf8");
  const nestedDir = path.join(outputDir, "legacy", "nested");
  mkdirSync(nestedDir, { recursive: true });
  writeFileSync(path.join(nestedDir, "old.py"), "print('old')\n", "utf8");
}

function createMultiFileFixture({ invalidPrefix = false } = {}) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "msra-multifile-"));
  const parentPath = path.join(tmpDir, "parent.msra");
  const childPath = path.join(tmpDir, "funcs.msraf");
  const parentText = [
    "[app]",
    'name="RootAPI"',
    'package_name="root_api"',
    "[app.groups.Catalog]",
    'description="Catalog group"',
    "[app.func]",
    '!include("funcs.msraf")',
    "",
  ].join("\n");
  const childText = [
    '!root("./parent.msra")',
    "",
    invalidPrefix ? "[app.func.GET_USER]" : "[GET_USER]",
    'group=<GROUPS.Catalog>',
    "",
  ].join("\n");
  writeFileSync(parentPath, parentText, "utf8");
  writeFileSync(childPath, childText, "utf8");
  return {
    tmpDir,
    parentPath,
    childPath,
    parentText,
    childText,
  };
}

test("generator wires external warmup scripts into the manager", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-warmup-"));
  const inputPath = path.join(workDir, "warmup.msra");
  const outputDir = path.join(workDir, "generated");
  const packageName = "test_pkg";
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const text = [
    "[app]",
    'name="PipelineApp"',
    'package_name="test_pkg"',
    'version="0.1.0"',
    "timeout_ms=1000",
    'browser=camoufox',
    'description=""',
    "@Humanize(0.5)",
    "@BlockImages",
    "",
    "[app.prefixes]",
    'MAIN_SITE_URL="https://example.com/"',
    "",
    "[app.warmup]",
    "@SniffHeaders",
    'warmup="./warmup.py:pipeline"',
    'on_error_screenshot_path="screenshot.png"',
    "",
  ].join("\n");

  try {
    writeFileSync(inputPath, text, "utf8");
    writeFileSync(
      path.join(workDir, "warmup.py"),
      readFileSync(path.join(repoRoot, "warmup.py"), "utf8"),
      "utf8",
    );
    const result = spawnSync("python", ["-m", "msra_codegen", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const packageDir = path.join(outputDir, packageName);
    const managerText = readFileSync(path.join(outputDir, packageName, "manager.py"), "utf8");
    assert.match(managerText, /from \.warmup import pipeline as warmup_runner/);
    assert.match(managerText, /await warmup_runner\(warmup\)/);
    assert.match(managerText, /Warmup\(/);
    assert.match(managerText, /humanize=0\.5/);
    assert.match(managerText, /block_images=True/);
    assert.match(managerText, /sniffer=sniffer/);
    assert.match(managerText, /prefixes=\{/);
    assert.doesNotMatch(managerText, /render_pipeline_steps\(/);

    const warmupModule = readFileSync(path.join(packageDir, "warmup.py"), "utf8");
    assert.match(warmupModule, /async def pipeline\(warmup: Warmup\)/);
    assert.match(warmupModule, /MAIN_SITE_URL/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("python codegen generates both bundled msra documents without failing", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-codegen-"));
  const currentYear = new Date().getFullYear();
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const cases = [
    {
      inputPath: path.join(repoRoot, "examples", "example.msra"),
      outputDir: path.join(workDir, "example"),
      packageOwner: "Miskler",
      packageName: "ozon_api",
      license: "GPL-3.0-or-later",
    },
    {
      inputPath: path.join(repoRoot, "examples", "fixprice", "fixprice.msra"),
      outputDir: path.join(workDir, "fixprice"),
      packageOwner: "Open-Inflation",
      packageName: "fixprice_api",
      license: "GPL-3.0",
    },
  ];
  const delimitedInputPath = path.join(workDir, "example-delimited.msra");
  const delimitedSource = readFileSync(path.join(repoRoot, "examples", "example.msra"), "utf8")
    .replace('package_name="ozon_api"', 'package_name="delimited_api"')
    .replace("style=repeat,", "style=delimited,")
    .replace('delimiter=","', 'delimiter="|"');
  writeFileSync(delimitedInputPath, delimitedSource, "utf8");
  writeFileSync(
    path.join(workDir, "warmup.py"),
    readFileSync(path.join(repoRoot, "warmup.py"), "utf8"),
    "utf8",
  );
  const mitInputPath = path.join(workDir, "example-mit.msra");
  const mitSource = readFileSync(path.join(repoRoot, "examples", "example.msra"), "utf8")
    .replace('package_name="ozon_api"', 'package_name="mit_api"')
    .replace('license="GPL-3.0-or-later"', 'license="MIT"');
  writeFileSync(mitInputPath, mitSource, "utf8");
  const printListInputPath = path.join(workDir, "example-print-list.msra");
  const printListSource = readFileSync(path.join(repoRoot, "examples", "example.msra"), "utf8")
    .replace('package_name="ozon_api"', 'package_name="print_list_api"')
    .replace("@Docs", '@Docs(print=["Первая строка", "Вторая строка"])');
  writeFileSync(printListInputPath, printListSource, "utf8");
  cases.push({
    inputPath: mitInputPath,
    outputDir: path.join(workDir, "mit"),
    packageOwner: "Miskler",
    packageName: "mit_api",
    license: "MIT",
  });
  cases.push({
    inputPath: delimitedInputPath,
    outputDir: path.join(workDir, "delimited"),
    packageOwner: "Miskler",
    packageName: "delimited_api",
    license: "GPL-3.0-or-later",
  });
  cases.push({
    inputPath: printListInputPath,
    outputDir: path.join(workDir, "print-list"),
    packageOwner: "Miskler",
    packageName: "print_list_api",
    license: "GPL-3.0-or-later",
  });

  try {
    for (const testCase of cases) {
      seedStaleOutput(testCase.outputDir);
      const result = spawnSync(
        "python",
        ["-m", "msra_codegen", testCase.inputPath, "-o", testCase.outputDir],
        {
          cwd: repoRoot,
          env: buildCodegenPythonPath(pythonReleasesFixturePath),
          encoding: "utf8",
        },
      );
      assert.strictEqual(result.status, 0, result.stderr || result.stdout);
      const readmeText = readFileSync(path.join(testCase.outputDir, "README.md"), "utf8");
      const exampleText = readFileSync(path.join(testCase.outputDir, "example.py"), "utf8");
      const quickStartText = readFileSync(path.join(testCase.outputDir, "docs", "source", "quick_start.rst"), "utf8");
      const pyprojectText = readFileSync(path.join(testCase.outputDir, "pyproject.toml"), "utf8");
      const licenseText = readFileSync(path.join(testCase.outputDir, "LICENSE"), "utf8");
      const readmePipelineCode = extractMarkdownCodeFence(readmeText);
      const quickStartPipelineCode = extractRstPythonCodeBlock(quickStartText);
      assert.match(readmeText, /# Usage/);
      assert.match(readmeText, /## Автотесты API \(pytest \+ snapshots\)/);
      assert.match(readmeText, /### Принцип работы/);
      assert.match(readmeText, /```py[\s\S]*async def main\(\):/);
      assert.doesNotMatch(readmeText, /examples\/pipeline\.py/);
      assert.ok(readmePipelineCode, "expected README to contain a python code block");
      assert.ok(quickStartPipelineCode, "expected quick_start.rst to contain a python code block");
      assert.strictEqual(normalizeNewlines(readmePipelineCode).trimEnd(), normalizeNewlines(exampleText).trimEnd());
      assert.strictEqual(normalizeNewlines(quickStartPipelineCode).trimEnd(), normalizeNewlines(exampleText).trimEnd());
      assert.match(readmeText, new RegExp(`https://github\\.com/${testCase.packageOwner}/${testCase.packageName}`));
      assert.match(readmeText, new RegExp(`https://${testCase.packageOwner.toLowerCase()}\\.github\\.io/${testCase.packageName}/quick_start`));
      assert.match(readmeText, new RegExp(`https://pypi\\.org/project/${testCase.packageName.replaceAll("_", "-")}/`));
      assert.match(readmeText, new RegExp(`https://img\\.shields\\.io/github/license/${testCase.packageOwner}/${testCase.packageName}`));
      assert.match(quickStartText, /.. code-block:: python[\s\S]*async def main\(\):/);
      assert.match(exampleText, /async def main\(\):/);
      assert.match(exampleText, /async with [A-Za-z0-9_]+\(\) as api:/);
      assert.doesNotMatch(exampleText, /\bpass\b/);
      if (testCase.packageName === "fixprice_api") {
        assert.match(exampleText, /print\(f"Первая категория: \{tree\[next\(iter\(tree\)\)\]\['alias'\]\}"\)/);
      }
      if (testCase.packageName === "print_list_api") {
        assert.match(exampleText, /print\(['"]Первая строка['"]\)/);
        assert.match(exampleText, /print\(['"]Вторая строка['"]\)/);
      }
      assert.ok(!existsSync(path.join(testCase.outputDir, "merged.msra")), "expected merged.msra to be cleaned up by default");
      assert.ok(!existsSync(path.join(testCase.outputDir, "stale.txt")), "expected stale root files to be removed by default");
      assert.ok(!existsSync(path.join(testCase.outputDir, "legacy")), "expected stale nested directories to be removed by default");
      assert.ok(!existsSync(path.join(testCase.outputDir, "examples")), "expected no separate examples/pipeline.py output directory");
      assert.match(pyprojectText, new RegExp(`^name = "${testCase.packageName}"$`, "m"));
      assert.match(pyprojectText, /^requires-python = ">=3\.10"$/m);
      assert.ok(pyprojectText.includes(`license = "${testCase.license}"`));
      assert.match(pyprojectText, /^keywords = \[/m);
      assert.match(pyprojectText, /^classifiers = \[/m);
      assert.match(pyprojectText, /Programming Language :: Python :: 3/);
      assert.match(pyprojectText, /Programming Language :: Python :: 3\.10/);
      assert.match(pyprojectText, /Programming Language :: Python :: 3\.13/);
      assert.doesNotMatch(pyprojectText, /Programming Language :: Python :: 3\.14/);
      assert.match(pyprojectText, /Operating System :: Microsoft :: Windows/);
      assert.match(pyprojectText, /Topic :: Utilities/);
      if (testCase.packageName === "fixprice_api") {
        assert.match(pyprojectText, /keywords = \[\r?\n\s*"fixprice",\r?\n\s*"api",\r?\n\s*"browser",\r?\n\s*"catalog"\r?\n\]/);
      } else {
        assert.match(pyprojectText, /keywords = \[\r?\n\s*"ozon",\r?\n\s*"api",\r?\n\s*"browser",\r?\n\s*"catalog"\r?\n\]/);
      }
      if (testCase.license === "MIT") {
        assert.match(licenseText, /MIT License/);
        assert.match(licenseText, new RegExp(`^Copyright \\(c\\) ${currentYear} `, "m"));
        assert.match(licenseText, /Miskler/);
        if (testCase.packageName === "mit_api") {
          assert.match(licenseText, /Another Author/);
        }
      } else {
        assert.match(licenseText, /GNU GENERAL PUBLIC LICENSE/);
      }
      assert.ok(!existsSync(path.join(testCase.outputDir, "LICENSES")));
      const packageDir = path.join(testCase.outputDir, testCase.packageName);
      const compileResult = spawnSync("python", ["-m", "compileall", "-q", packageDir], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      assert.strictEqual(compileResult.status, 0, compileResult.stderr || compileResult.stdout);
      const abstractionInit = readFileSync(path.join(packageDir, "abstraction", "__init__.py"), "utf8");
      assert.match(abstractionInit, /from \.output import Output/);
      const outputModule = readFileSync(path.join(packageDir, "abstraction", "output.py"), "utf8");
      assert.match(outputModule, /class Output/);
      assert.match(outputModule, /def image\(/);
      assert.doesNotMatch(outputModule, /_Awaitable/);
      assert.doesNotMatch(outputModule, /_wrap_awaitable/);
      if (testCase.packageName === "ozon_api") {
        const productModule = readFileSync(path.join(packageDir, "endpoints", "catalog", "product.py"), "utf8");
        assert.match(productModule, /async def feed\(self, query: str \| None = None, url: list\[Literal\['\/searchSuggestions\/search\/'\]\] \| None = None, filename: str \| None = None\) -> abstraction\.Output:/);
        assert.match(productModule, /request_url = self\._parent\._BASE_API/);
        assert.match(productModule, /if _url_values in \(None, \[\]\):/);
        assert.match(productModule, /query_params\.append\(\('url', ','.join\(str\(__item\) for __item in _url_values\)\)\)/);
        assert.match(productModule, /query_params\.append\(\('from_global', 'true'\)\)/);
        assert.match(readmeText, /Пример поиска по одному запросу/);
        assert.match(readmeText, /smoke = \(await api\.Catalog\.Product\.feed\(query='example'\)\)\.json\(\)/);
      } else if (testCase.packageName === "delimited_api") {
        const productModule = readFileSync(path.join(packageDir, "endpoints", "catalog", "product.py"), "utf8");
        assert.match(productModule, /query_params\.append\(\('url', '\|'\.join\(str\(__item\) for __item in _url_values\)\)\)/);
      } else if (testCase.packageName === "fixprice_api") {
        const productModule = readFileSync(path.join(packageDir, "endpoints", "catalog", "products.py"), "utf8");
        const generalModule = readFileSync(path.join(packageDir, "endpoints", "general.py"), "utf8");
        const geolocationModule = readFileSync(path.join(packageDir, "endpoints", "geolocation.py"), "utf8");
        const managerModule = readFileSync(path.join(packageDir, "manager.py"), "utf8");
        const regexesModule = readFileSync(path.join(packageDir, "abstraction", "regexes.py"), "utf8");
        const catalogSortModule = readFileSync(path.join(packageDir, "abstraction", "catalog_sort.py"), "utf8");
        assert.match(productModule, /from \.goto_pipeline import pipeline as goto_pipeline_runner/);
        assert.match(productModule, /await goto_pipeline_runner\(warmup\)/);
        assert.match(productModule, /extractors\/catalog-product-info\.js/);
        assert.match(generalModule, /async def download_image\(self, url: str\) -> abstraction\.Output:/);
        assert.match(generalModule, /return await self\._parent\._direct_request\(request_url\)/);
        assert.doesNotMatch(generalModule, /retry_attempts/);
        assert.doesNotMatch(generalModule, /timeout/);
        assert.match(managerModule, /def client_route\(self, value: str \| None\) -> None:/);
        assert.doesNotMatch(managerModule, /@city_id\.setter/);
        assert.doesNotMatch(managerModule, /_coerce_variable_value/);
        assert.match(managerModule, /_city_id_raw = self\.unstandard_headers\.get\('x-city'\)/);
        assert.match(managerModule, /self\._city_id = _city_id_value/);
        assert.match(managerModule, /if float\(_city_id_value\) < 1 or float\(_city_id_value\) > 2147483647:/);
        assert.match(managerModule, /_client_route_raw = self\.unstandard_headers\.get\('x-client-route'\)/);
        assert.match(managerModule, /self\.client_route = _client_route_raw if isinstance\(_client_route_raw, str\) else str\(_client_route_raw\)/);
        assert.doesNotMatch(managerModule, /re\.fullmatch\(/);
        assert.match(managerModule, /abstraction\.RegexLanguageTag\.match\(value\)/);
        assert.match(managerModule, /abstraction\.RegexStoreId\.match\(value\)/);
        assert.match(regexesModule, /class RegexBase:/);
        assert.match(regexesModule, /class RegexCountryAlias\(RegexBase\):/);
        assert.match(regexesModule, /class RegexLanguageTag\(RegexBase\):/);
        assert.match(regexesModule, /return re\.fullmatch\(cls\.REGEX, str\(value\)\) is not None/);
        assert.doesNotMatch(geolocationModule, /re\.fullmatch\(/);
        assert.match(geolocationModule, /if not \(abstraction\.RegexCountryAlias\.match\(alias\)\):/);
        const deliveryTypeBlock = regexesModule.split("class RegexDeliveryType(RegexBase):")[1].split("class RegexStoreId(RegexBase):")[0];
        assert.match(deliveryTypeBlock, /^\r?\n    REGEX = /);
        assert.doesNotMatch(deliveryTypeBlock, /\n\s*\n\s*REGEX = /);
        assert.doesNotMatch(deliveryTypeBlock, /ERROR = /);
        assert.doesNotMatch(exampleText, /^\s*# tree$/m);
        assert.match(exampleText, /Загрузка изображения по прямой ссылке/);
        assert.match(exampleText, /download_image = \(await api\.General\.download_image\(url=products_list\[0\]\['images'\]\[0\]\['src'\]\)\)\.image\(\)/);
        assert.doesNotMatch(exampleText, /Image\.open\(download_image\)/);
        assert.doesNotMatch(readmeText, /^\s*# tree$/m);
        assert.match(readmeText, /Загрузка изображения по прямой ссылке/);
        assert.match(readmeText, /download_image = \(await api\.General\.download_image\(url=products_list\[0\]\['images'\]\[0\]\['src'\]\)\)\.image\(\)/);
        assert.doesNotMatch(readmeText, /Image\.open\(download_image\)/);
        assert.match(readmeText, /FixPrice API - https:\/\/fix-price\.com\//);
        assert.match(readmeText, /https:\/\/t\.me\/miskler_dev/);
        assert.match(readmeText, /https:\/\/discord\.gg\/UnJnGHNbBp/);
        assert.match(readmeText, /tree\[next\(iter\(tree\)\)\]\['alias'\]/);
        assert.match(exampleText, /tree\[next\(iter\(tree\)\)\]\['alias'\]/);
        assert.doesNotMatch(managerModule, /Async client generated from MSRA|Generated async client/);
        assert.doesNotMatch(regexesModule, /Shared regex patterns and their validation messages/);
        assert.doesNotMatch(catalogSortModule, /Generated sort helpers|Sort order helper|Most popular first|Cheapest first|Most expensive first/);
        assert.match(pyprojectText, /email = "mail@miskler\.ru"/);
      }
      for (const filePath of collectPythonFiles(packageDir)) {
        const source = readFileSync(filePath, "utf8");
        assert.doesNotMatch(source, /\bApiParent\b/);
        assert.doesNotMatch(source, /\bApiChild\b/);
        assert.doesNotMatch(source, /\bapi_child_field\b/);
        if (!filePath.endsWith(path.join("abstraction", "output.py"))) {
          assert.doesNotMatch(source, /\bFetchResponse\b/);
          assert.doesNotMatch(source, /\bPWResponse\b/);
          assert.doesNotMatch(source, /\bBytesIO\b/);
        }
      }
      const warmupModule = readFileSync(path.join(packageDir, "warmup.py"), "utf8");
      assert.match(warmupModule, /async def pipeline\(warmup: Warmup\)/);
      const managerModule = readFileSync(path.join(packageDir, "manager.py"), "utf8");
      assert.match(managerModule, /def city_id\(self\) -> int \| None:/);
      if (testCase.packageName === "fixprice_api") {
        assert.match(managerModule, /_city_id_raw = self\.unstandard_headers\.get\('x-city'\)/);
        assert.match(managerModule, /self\._city_id = _city_id_value/);
        assert.match(managerModule, /allowed_values = \['store', 'pickup', 'courier'\]/);
        assert.match(managerModule, /if value not in allowed_values:/);
        assert.match(readFileSync(path.join(packageDir, "goto_pipeline.py"), "utf8"), /async def pipeline\(warmup: Warmup\)/);
        assert.match(readFileSync(path.join(packageDir, "extractors", "catalog-product-info.js"), "utf8"), /window\.__NUXT__=/);
        assert.match(readmeText, /en = \(await api\.Geolocation\.countries_list\(alias='en'\)\)\.json\(\)/);
        assert.match(readmeText, /ru = \(await api\.Geolocation\.countries_list\(alias='ru'\)\)\.json\(\)/);
        assert.match(exampleText, /en = \(await api\.Geolocation\.countries_list\(alias='en'\)\)\.json\(\)/);
        assert.match(exampleText, /ru = \(await api\.Geolocation\.countries_list\(alias='ru'\)\)\.json\(\)/);
      } else {
        assert.match(managerModule, /@city_id\.setter/);
        assert.match(managerModule, /if value is None:\r?\n\s+self\._city_id = None/);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("readme pipeline uses example type=image instead of function name", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-image-readme-"));
  const inputPath = path.join(workDir, "image.msra");
  const outputDir = path.join(workDir, "generated");
  const packageName = "image_api";
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const text = [
    "[app]",
    'name="ImageAPI"',
    'package_name="image_api"',
    'version="0.1.0"',
    "browser=firefox",
    "",
    "[app.groups.General]",
    'description="General"',
    "",
    "[app.func.A3A417]",
    'name="fetch_asset"',
    "transport=direct",
    "method=GET",
    "group=<GROUPS.General>",
    "",
    "[app.func.A3A417.input.url]",
    "type=string",
    "@Required",
    'description="Direct image URL."',
    "",
    "[app.func.A3A417.examples.snapshot]",
    "@Test",
    "@Docs",
    "type=image",
    'description="Image example"',
    'inputs={"url"="https://example.com/image.png"}',
    "",
  ].join("\n");

  try {
    writeFileSync(inputPath, text, "utf8");
    const result = spawnSync("python", ["-m", "msra_codegen", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const exampleText = readFileSync(path.join(outputDir, "example.py"), "utf8");
    const readmeText = readFileSync(path.join(outputDir, "README.md"), "utf8");
    const quickStartText = readFileSync(path.join(outputDir, "docs", "source", "quick_start.rst"), "utf8");
    assert.doesNotMatch(exampleText, /image_url =/);
    assert.match(exampleText, /snapshot = \(await api\.General\.fetch_asset\(url=['"]https:\/\/example\.com\/image\.png['"]\)\)\.image\(\)/);
    assert.doesNotMatch(exampleText, /Image\.open\(/);
    assert.doesNotMatch(readmeText, /image_url =/);
    assert.match(readmeText, /snapshot = \(await api\.General\.fetch_asset\(url=['"]https:\/\/example\.com\/image\.png['"]\)\)\.image\(\)/);
    assert.doesNotMatch(readmeText, /Image\.open\(/);
    assert.doesNotMatch(quickStartText, /image_url =/);
    assert.match(quickStartText, /snapshot = \(await api\.General\.fetch_asset\(url=['"]https:\/\/example\.com\/image\.png['"]\)\)\.image\(\)/);
    assert.doesNotMatch(quickStartText, /Image\.open\(/);
    assert.ok(!existsSync(path.join(outputDir, "merged.msra")), "expected merged.msra to be cleaned up by default");
    assert.ok(!existsSync(path.join(outputDir, "examples")), "expected no separate examples/pipeline.py output directory");
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("readme pipeline fails generation for non-doc FUNCRESULT dependencies", () => {
  const script = [
    "import json, sys",
    "from msra_codegen.readme_pipeline import build_readme_pipeline_code",
    'project = json.loads(sys.argv[1])',
    'print(build_readme_pipeline_code(project, project["app"]["package_name"], project["app"]["client_class_name"]))',
  ].join("; ");
  const project = {
    app: {
      name: "RuntimeErrorAPI",
      package_name: "runtime_error_api",
      client_class_name: "RuntimeErrorAPI",
    },
    functions: [
      {
        id: "SRC",
        name: "source_data",
        group: "General",
        transport: "fetch",
        examples: [
          {
            name: "source_snapshot",
            test: true,
            inputs: {
              kind: "inline_table",
              items: [{ key: "query", value: { kind: "string", value: "source" } }],
            },
          },
        ],
      },
      {
        id: "DST",
        name: "consume_source",
        group: "General",
        transport: "fetch",
        examples: [
          {
            name: "doc_snapshot",
            docs: true,
            inputs: {
              kind: "inline_table",
              items: [
                {
                  key: "query",
                  value: {
                    kind: "ref",
                    parts: [
                      { kind: "name", value: "FUNCRESULT" },
                      { kind: "name", value: "SRC" },
                      { kind: "name", value: "source_snapshot" },
                      { kind: "name", value: "JSON" },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const result = spawnSync("python", ["-c", script, JSON.stringify(project)], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
  });
  const combinedOutput = `${result.stdout || ""}${result.stderr || ""}`;

  assert.notStrictEqual(result.status, 0, "expected codegen to fail instead of emitting a runtime helper");
  assert.match(combinedOutput, /Referenced example \[app\.func\.SRC\.examples\.source_snapshot\] is not included in generated docs/);
  assert.doesNotMatch(combinedOutput, /_missing_readme_example_dependency\(/);
  assert.doesNotMatch(combinedOutput, /source_snapshot =/);
});

test("readme pipeline rejects @Key selectors below -1", () => {
  const script = [
    "import json, sys",
    "from msra_codegen.readme_pipeline import build_readme_pipeline_code",
    'project = json.loads(sys.argv[1])',
    'print(build_readme_pipeline_code(project, project["app"]["package_name"], project["app"]["client_class_name"]))',
  ].join("; ");
  const project = {
    app: {
      name: "KeySelectorAPI",
      package_name: "key_selector_api",
      client_class_name: "KeySelectorAPI",
    },
    functions: [
      {
        id: "SRC",
        name: "source_data",
        group: "General",
        transport: "fetch",
        examples: [
          {
            name: "source_snapshot",
            docs: true,
            inputs: {
              kind: "inline_table",
              items: [{ key: "query", value: { kind: "string", value: "source" } }],
            },
          },
        ],
      },
      {
        id: "DST",
        name: "consume_source",
        group: "General",
        transport: "fetch",
        examples: [
          {
            name: "doc_snapshot",
            docs: true,
            inputs: {
              kind: "inline_table",
              items: [
                {
                  key: "query",
                  value: {
                    kind: "ref",
                    parts: [
                      { kind: "name", value: "FUNCRESULT" },
                      { kind: "name", value: "SRC" },
                      { kind: "name", value: "source_snapshot" },
                      { kind: "name", value: "JSON" },
                      {
                        kind: "key",
                        value: { kind: "number", value: -2, raw: "-2" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const result = spawnSync("python", ["-c", script, JSON.stringify(project)], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
  });
  const combinedOutput = `${result.stdout || ""}${result.stderr || ""}`;

  assert.notStrictEqual(result.status, 0, "expected codegen to fail for invalid @Key selectors");
  assert.match(combinedOutput, /@Key with an invalid id/);
  assert.doesNotMatch(combinedOutput, /next\(iter\(/);
});

test("generator writes a merged intermediate msra file", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const fixture = createMultiFileFixture();
  const outputDir = path.join(fixture.tmpDir, "generated");
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(fixture.tmpDir);
  try {
    const result = spawnSync(
      "python",
      ["-m", "msra_codegen.cli", fixture.parentPath, "-o", outputDir, "--no-cleanup"],
      {
        cwd: repoRoot,
        env: buildCodegenPythonPath(pythonReleasesFixturePath),
        encoding: "utf8",
      },
    );

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const mergedPath = path.join(outputDir, "merged.msra");
    assert.ok(existsSync(mergedPath), "expected the merged intermediate file to be written");
    const mergedText = readFileSync(mergedPath, "utf8");
    assert.match(mergedText, /\[app\.func\.GET_USER\]/);
    assert.match(mergedText, /\[app\.groups\.Catalog\]/);
    assert.ok(!mergedText.includes("!include("), "expected merged source to inline the child file instead of keeping include directives");
    assert.ok(!mergedText.includes("!root("), "expected merged source to omit the child LSP root directive");
  } finally {
    rmSync(fixture.tmpDir, { recursive: true, force: true });
  }
});
