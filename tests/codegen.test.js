const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n");
}

function normalizeSphinxText(text) {
  return normalizeNewlines(text)
    .replace(/-\n\s+/g, "-")
    .replace(/\n\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function buildGeneratedPackageProbeScript() {
  return [
    "from __future__ import annotations",
    "",
    "import dataclasses",
    "import importlib",
    "import sys",
    "import types",
    "",
    "",
    "def make_module(name: str, *, package: bool = False, **attrs):",
    "    module = types.ModuleType(name)",
    "    module.__dict__.update(attrs)",
    "    if package:",
    "        module.__path__ = []",
    "    sys.modules[name] = module",
    "    parent_name, _, child_name = name.rpartition(\".\")",
    "    if parent_name and parent_name in sys.modules:",
    "        setattr(sys.modules[parent_name], child_name, module)",
    "    return module",
    "",
    "",
    "class DummyObject:",
    "    def __init__(self, *args, **kwargs):",
    "        self.args = args",
    "        self.kwargs = kwargs",
    "",
    "    def __getattr__(self, _name):",
    "        return self",
    "",
    "    def __call__(self, *args, **kwargs):",
    "        return self",
    "",
    "",
    "class DummyProxy:",
    "    env_sentinel = object()",
    "",
    "    def __init__(self, value=None):",
    "        self.value = value",
    "",
    "    @staticmethod",
    "    def from_env():",
    "        return DummyProxy.env_sentinel",
    "",
    "    def as_dict(self):",
    "        return {\"proxy\": self.value}",
    "",
    "    def as_str(self):",
    "        return \"proxy://example\"",
    "",
    "",
    "def autotest(func):",
    "    return func",
    "",
    "",
    "make_module(\"aiohttp_retry\", ExponentialRetry=DummyObject, RetryClient=DummyObject)",
    "make_module(\"camoufox\", AsyncCamoufox=DummyObject, DefaultAddons=types.SimpleNamespace(UBO=object()))",
    "make_module(\"human_requests\", HumanBrowser=DummyObject, HumanContext=DummyObject, HumanPage=DummyObject, autotest=autotest)",
    "make_module(",
    "    \"human_requests.abstraction\",",
    "    HttpMethod=types.SimpleNamespace(GET=\"GET\", POST=\"POST\", PUT=\"PUT\", PATCH=\"PATCH\", DELETE=\"DELETE\", HEAD=\"HEAD\", OPTIONS=\"OPTIONS\"),",
    "    Proxy=DummyProxy,",
    "    FetchResponse=DummyObject,",
    ")",
    "make_module(\"human_requests.network_analyzer\", package=True)",
    "make_module(\"human_requests.network_analyzer.anomaly_sniffer\", HeaderAnomalySniffer=DummyObject, WaitHeader=DummyObject, WaitSource=types.SimpleNamespace(REQUEST=\"REQUEST\"))",
    "make_module(\"rich\", package=True)",
    "make_module(\"rich.console\", Console=DummyObject)",
    "make_module(\"rich.highlighter\", ReprHighlighter=DummyObject)",
    "make_module(\"rich.panel\", Panel=DummyObject)",
    "make_module(\"rich.syntax\", Syntax=DummyObject)",
    "make_module(\"rich.table\", Table=DummyObject)",
    "make_module(\"rich.text\", Text=DummyObject)",
    "",
    "output_dir = sys.argv[1]",
    "package_name = sys.argv[2]",
    "sys.path.insert(0, output_dir)",
    "",
    "pkg = importlib.import_module(package_name)",
    "client_class_name = pkg.__all__[0]",
    "client_cls = getattr(pkg, client_class_name)",
    "warmup_cls = pkg.Warmup",
    "",
    "assert dataclasses.is_dataclass(client_cls)",
    "assert dataclasses.is_dataclass(warmup_cls)",
    "field_names = [field.name for field in dataclasses.fields(client_cls)]",
    "base_field_names = [\"timeout_ms\", \"headless\", \"test_mode\", \"proxy\", \"browser_opts\"]",
    "assert field_names[:len(base_field_names)] == base_field_names",
    "group_field_names = field_names[len(base_field_names):]",
    "assert group_field_names",
    "assert [field.name for field in dataclasses.fields(warmup_cls)] == [\"browser\", \"context\", \"page\", \"sniffer\", \"timeout_ms\", \"test_mode\", \"prefixes\"]",
    "",
    "instance = client_cls(proxy=None, browser_opts=None)",
    "assert instance.proxy is DummyProxy.env_sentinel",
    "assert instance.browser_opts == {}",
    "assert instance.timeout_ms == client_cls.__dataclass_fields__[\"timeout_ms\"].default",
    "for field_name in group_field_names:",
    "    assert field_name in instance.__dict__",
    "    group = getattr(instance, field_name)",
    "    assert instance.__dict__[field_name] is group",
    "    assert getattr(group, \"_parent\", None) is instance",
  ].join("\n");
}

function buildSphinxTextDocs(outputDir, repoRoot) {
  const docsSourceDir = path.join(outputDir, "docs", "source");
  const docsBuildDir = path.join(outputDir, "docs", "_build", "text");
  const result = spawnSync(
    "python",
    ["-m", "sphinx", "-b", "text", "-E", docsSourceDir, docsBuildDir],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  return docsBuildDir;
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
      readFileSync(path.join(repoRoot, "examples", "example", "warmup.py"), "utf8"),
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
    assert.match(managerText, /from \.pipelines\.warmup import pipeline as warmup_runner/);
    assert.match(managerText, /await warmup_runner\(warmup\)/);
    assert.match(managerText, /Warmup\(/);
    assert.match(managerText, /humanize=0\.5/);
    assert.match(managerText, /block_images=True/);
    assert.match(managerText, /sniffer=sniffer/);
    assert.match(managerText, /prefixes=\{/);
    assert.doesNotMatch(managerText, /render_pipeline_steps\(/);
    assert.ok(existsSync(path.join(packageDir, "pipelines", "__init__.py")), "expected pipelines package to be generated");
    assert.ok(existsSync(path.join(packageDir, "pipelines", "warmup.py")), "expected warmup pipeline to live under pipelines/");
    assert.ok(!existsSync(path.join(packageDir, "warmup.py")), "expected no legacy root-level warmup.py");

    const warmupModule = readFileSync(path.join(packageDir, "pipelines", "warmup.py"), "utf8");
    assert.match(warmupModule, /async def pipeline\(warmup: Warmup\)/);
    assert.match(warmupModule, /MAIN_SITE_URL/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("generator omits empty class docstrings when the app description is missing", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-nodoc-"));
  const inputPath = path.join(workDir, "nodoc.msra");
  const outputDir = path.join(workDir, "generated");
  const packageName = "nodoc_api";
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const text = readFileSync(path.join(repoRoot, "examples", "example", "example.msra"), "utf8")
    .replace('package_name="ozon_api"', 'package_name="nodoc_api"')
    .replace(/^description="Ozon API integration for catalog browsing and cart flows"$/m, "");

  try {
    writeFileSync(inputPath, text, "utf8");
    writeFileSync(
      path.join(workDir, "warmup.py"),
      readFileSync(path.join(repoRoot, "examples", "example", "warmup.py"), "utf8"),
      "utf8",
    );
    const result = spawnSync("python", ["-m", "msra_codegen", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const managerText = readFileSync(path.join(outputDir, packageName, "manager.py"), "utf8");
    assert.doesNotMatch(managerText, /""""""/);
    assert.match(managerText, /class OzonAPI:\r?\n\s+timeout_ms: float = 35000/);
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
      inputPath: path.join(repoRoot, "examples", "example", "example.msra"),
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
      license: "MIT",
    },
  ];
  const delimitedInputPath = path.join(workDir, "example-delimited.msra");
  const delimitedSource = readFileSync(path.join(repoRoot, "examples", "example", "example.msra"), "utf8")
    .replace('package_name="ozon_api"', 'package_name="delimited_api"')
    .replace("style=repeat,", "style=delimited,")
    .replace('delimiter=","', 'delimiter="|"');
  writeFileSync(delimitedInputPath, delimitedSource, "utf8");
  writeFileSync(
    path.join(workDir, "warmup.py"),
    readFileSync(path.join(repoRoot, "examples", "example", "warmup.py"), "utf8"),
    "utf8",
  );
  const mitInputPath = path.join(workDir, "example-mit.msra");
  const mitSource = readFileSync(path.join(repoRoot, "examples", "example", "example.msra"), "utf8")
    .replace('package_name="ozon_api"', 'package_name="mit_api"')
    .replace('license="GPL-3.0-or-later"', 'license="MIT"');
  writeFileSync(mitInputPath, mitSource, "utf8");
  const printListInputPath = path.join(workDir, "example-print-list.msra");
  const printListSource = readFileSync(path.join(repoRoot, "examples", "example", "example.msra"), "utf8")
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
      const requirementsText = readFileSync(path.join(testCase.outputDir, "requirements.txt"), "utf8");
      const licenseText = readFileSync(path.join(testCase.outputDir, "LICENSE"), "utf8");
      const packageDir = path.join(testCase.outputDir, testCase.packageName);
      const testsDir = path.join(testCase.outputDir, "tests");
      const conftestText = readFileSync(path.join(testsDir, "conftest.py"), "utf8");
      const apiTestText = readFileSync(path.join(testsDir, "api_test.py"), "utf8");
      const readmePipelineCode = extractMarkdownCodeFence(readmeText);
      const quickStartPipelineCode = extractRstPythonCodeBlock(quickStartText);
      assert.match(readmeText, /# Usage/);
      assert.match(readmeText, /## Автотесты API \(pytest \+ snapshots\)/);
      assert.match(readmeText, /### Принцип работы/);
      assert.match(readmeText, /pytest-jsonschema-snapshot/);
      assert.match(readmeText, /pytest-anyio/);
      if (testCase.packageName === "fixprice_api") {
        assert.match(readmeText, /^Аснинхронный неофициальный API клиент для сайта fix-price\.com$/m);
        assert.match(pyprojectText, /^description = "Аснинхронный неофициальный API клиент для сайта fix-price\.com"$/m);
      } else {
        assert.match(readmeText, /Ozon API integration for catalog browsing and cart flows/);
        assert.match(pyprojectText, /^description = "Ozon API integration for catalog browsing and cart flows"$/m);
      }
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
      assert.match(
        pyprojectText,
        /\[project\.optional-dependencies\][\s\S]*tests = \[\r?\n\s*"pytest",\r?\n\s*"pytest-anyio",\r?\n\s*"pytest-jsonschema-snapshot"\r?\n\]/,
      );
      assert.match(pyprojectText, /Programming Language :: Python :: 3/);
      assert.match(pyprojectText, /Programming Language :: Python :: 3\.10/);
      assert.match(pyprojectText, /Programming Language :: Python :: 3\.13/);
      assert.doesNotMatch(pyprojectText, /Programming Language :: Python :: 3\.14/);
      assert.match(pyprojectText, /Operating System :: Microsoft :: Windows/);
      assert.match(pyprojectText, /Topic :: Utilities/);
      assert.ok(existsSync(path.join(testsDir, "__snapshots__")), "expected tests/__snapshots__ to be generated");
      assert.match(conftestText, /def anyio_backend\(\):/);
      assert.match(conftestText, /async def api\(\):/);
      assert.doesNotMatch(conftestText, /abstraction/);
      assert.match(apiTestText, /from human_requests import autotest_data, autotest_depends_on, autotest_hook, autotest_params/);
      assert.match(apiTestText, /from human_requests\.autotest import AutotestCallContext, AutotestContext, AutotestDataContext/);
      assert.doesNotMatch(apiTestText, /abstraction/);
      const probeResult = spawnSync(
        "python",
        ["-c", buildGeneratedPackageProbeScript(), testCase.outputDir, testCase.packageName],
        {
          cwd: repoRoot,
          env: buildCodegenPythonPath(pythonReleasesFixturePath),
          encoding: "utf8",
        },
      );
      assert.strictEqual(probeResult.status, 0, probeResult.stderr || probeResult.stdout);
      if (testCase.packageName === "fixprice_api") {
        const docsBuildDir = buildSphinxTextDocs(testCase.outputDir, repoRoot);
        const managerDocsText = readFileSync(
          path.join(docsBuildDir, "_api", `${testCase.packageName}.manager.txt`),
          "utf8",
        );
        const normalizedManagerDocsText = normalizeSphinxText(managerDocsText);
        assert.doesNotMatch(managerDocsText, /Attributes:/);
        assert.doesNotMatch(managerDocsText, /@SniffHeaders/);
        assert.doesNotMatch(managerDocsText, /\[app\.prefixes\]/);
        assert.doesNotMatch(managerDocsText, /MSRA document/);
        assert.ok(
          normalizedManagerDocsText.includes(
            "browser: HumanBrowser Browser session available to warmup scripts.",
          ),
        );
        assert.ok(
          normalizedManagerDocsText.includes(
            "context: HumanContext Browser context created during warmup.",
          ),
        );
        assert.ok(
          normalizedManagerDocsText.includes(
            "page: HumanPage Page used during warmup scripts.",
          ),
        );
        assert.ok(
          normalizedManagerDocsText.includes(
            "timeout_ms: float = 35000 Global timeout, in milliseconds, used by warmup and browser-backed requests.",
          ),
        );
        assert.ok(
          normalizedManagerDocsText.includes(
            "headless: bool = True Whether the browser is started without a visible window.",
          ),
        );
        assert.ok(
          normalizedManagerDocsText.includes(
            "test_mode: bool = False Enable the test-only warmup branch and its extra state.",
          ),
        );
        assert.ok(
          normalizedManagerDocsText.includes(
            "proxy: str | dict | human_requests.abstraction.Proxy | None = None Proxy settings for browser startup and direct requests. When omitted or set to None, the client reads the proxy from the environment.",
          ),
        );
        assert.ok(
          normalizedManagerDocsText.includes(
            "browser_opts: dict[str, Any] | None = None Extra keyword arguments forwarded to AsyncCamoufox during browser startup.",
          ),
        );
        assert.ok(
          normalizedManagerDocsText.includes(
            "sniffer: HeaderAnomalySniffer | None Optional header sniffer used during warmup when header sniffing is enabled.",
          ),
        );
        assert.ok(
          normalizedManagerDocsText.includes(
            "timeout_ms: int Effective timeout, in milliseconds, shared by warmup actions.",
          ),
        );
        assert.ok(
          normalizedManagerDocsText.includes(
            "test_mode: bool Whether the client was started in test mode.",
          ),
        );
        assert.ok(
          normalizedManagerDocsText.includes(
            "prefixes: dict[str, str] Resolved shared prefix values configured for the app.",
          ),
        );
        const advertisingEndpointText = readFileSync(path.join(packageDir, "endpoints", "advertising.py"), "utf8");
    const catalogEndpointText = readFileSync(path.join(packageDir, "endpoints", "catalog", "catalog.py"), "utf8");
    const catalogProductsEndpointText = readFileSync(path.join(packageDir, "endpoints", "catalog", "products.py"), "utf8");
    const generalEndpointText = readFileSync(path.join(packageDir, "endpoints", "general.py"), "utf8");
    const geolocationEndpointText = readFileSync(path.join(packageDir, "endpoints", "geolocation.py"), "utf8");
    assert.ok(existsSync(path.join(packageDir, "pipelines", "__init__.py")), "expected pipelines package to be generated");
    assert.ok(existsSync(path.join(packageDir, "pipelines", "warmup.py")), "expected warmup pipeline to live under pipelines/");
    assert.ok(existsSync(path.join(packageDir, "pipelines", "goto_pipeline.py")), "expected goto pipeline to live under pipelines/");
    assert.ok(!existsSync(path.join(packageDir, "warmup.py")), "expected no legacy root-level warmup.py");
    assert.ok(!existsSync(path.join(packageDir, "goto_pipeline.py")), "expected no legacy root-level goto_pipeline.py");
    assert.match(advertisingEndpointText, /@autotest/);
    assert.match(catalogEndpointText, /@autotest/);
    assert.match(catalogProductsEndpointText, /@autotest/);
    assert.match(catalogProductsEndpointText, /from \.\.\.pipelines\.goto_pipeline import pipeline as goto_pipeline_runner/);
    assert.match(catalogProductsEndpointText, /Path\(__file__\)\.resolve\(\)\.parents\[2\] \/ 'extractors\/catalog-product-info\.js'/);
    assert.match(geolocationEndpointText, /@autotest/);
    assert.doesNotMatch(generalEndpointText, /@autotest/);
  }
      if (testCase.packageName === "fixprice_api") {
        assert.match(pyprojectText, /keywords = \[\r?\n\s*"fixprice",\r?\n\s*"api",\r?\n\s*"browser",\r?\n\s*"catalog"\r?\n\]/);
        assert.match(pyprojectText, /dependencies = \[\r?\n\s*"camoufox\[geoip\]",\r?\n\s*"human_requests",\r?\n\s*"Pillow",\r?\n\s*"rich",\r?\n\s*"aiohttp",\r?\n\s*"aiohttp-retry"\r?\n\]/);
        assert.strictEqual(
          normalizeNewlines(requirementsText).trimEnd(),
          [
            "camoufox[geoip]",
            "human_requests",
            "Pillow",
            "rich",
            "aiohttp",
            "aiohttp-retry",
          ].join("\n"),
        );
      } else {
        assert.match(pyprojectText, /keywords = \[\r?\n\s*"ozon",\r?\n\s*"api",\r?\n\s*"browser",\r?\n\s*"catalog"\r?\n\]/);
        assert.match(pyprojectText, /dependencies = \[\r?\n\s*"camoufox\[geoip\]",\r?\n\s*"human_requests",\r?\n\s*"Pillow",\r?\n\s*"rich"\r?\n\]/);
        assert.strictEqual(
          normalizeNewlines(requirementsText).trimEnd(),
          [
            "camoufox[geoip]",
            "human_requests",
            "Pillow",
            "rich",
          ].join("\n"),
        );
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
      const compileResult = spawnSync("python", ["-m", "compileall", "-q", packageDir, testsDir], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      assert.strictEqual(compileResult.status, 0, compileResult.stderr || compileResult.stdout);
      assert.match(readmeText, /### Report/);
      assert.match(readmeText, new RegExp(`https://github\\.com/${testCase.packageOwner}/${testCase.packageName}/issues`));
      if (testCase.packageName === "fixprice_api") {
        assert.match(readmeText, /Загрузка изображения по прямой ссылке/);
        assert.match(readmeText, /download_image = \(await api\.General\.download_image\(url=products_list\[0\]\['images'\]\[0\]\['src'\]\)\)\.image\(\)/);
        assert.doesNotMatch(readmeText, /Image\.open\(download_image\)/);
        assert.match(readmeText, /tree\[next\(iter\(tree\)\)\]\['alias'\]/);
        assert.match(exampleText, /tree\[next\(iter\(tree\)\)\]\['alias'\]/);
        assert.match(readmeText, /https:\/\/t\.me\/miskler_dev/);
        assert.match(readmeText, /https:\/\/discord\.gg\/UnJnGHNbBp/);

        const jsonDebugScript = [
          "import sys",
          "sys.path.insert(0, sys.argv[1])",
          "from fixprice_api.abstraction.output import Output",
          "try:",
          "    Output.from_raw(b'{bad json').json()",
          "except Exception:",
          "    pass",
        ].join("\n");
        const jsonDebugResult = spawnSync("python", ["-c", jsonDebugScript, testCase.outputDir], {
          cwd: repoRoot,
          encoding: "utf8",
        });
        assert.strictEqual(jsonDebugResult.status, 0, jsonDebugResult.stderr || jsonDebugResult.stdout);
        assert.match(jsonDebugResult.stdout, /JSON parse failed/);
        assert.match(jsonDebugResult.stdout, /Fragment:/);
      } else {
        assert.match(readmeText, /Пример поиска по одному запросу/);
        assert.match(readmeText, /smoke = \(await api\.Catalog\.Product\.feed\(query='example'\)\)\.json\(\)/);
      }
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("python codegen emits schemashot-backed text tests for @Test text examples", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-text-tests-"));
  const inputPath = path.join(workDir, "text-example.msra");
  const outputDir = path.join(workDir, "generated");
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const source = normalizeNewlines(readFileSync(path.join(repoRoot, "examples", "example", "example.msra"), "utf8"))
    .replace('package_name="ozon_api"', 'package_name="text_api"')
    .replace(
      "[app.func.A3A417.examples.smoke]\n@Test\n@Docs\n",
      "[app.func.A3A417.examples.smoke]\n@Test\n@Docs\ntype=text\n",
    );

  try {
    writeFileSync(inputPath, source, "utf8");
    writeFileSync(
      path.join(workDir, "warmup.py"),
      readFileSync(path.join(repoRoot, "examples", "example", "warmup.py"), "utf8"),
      "utf8",
    );
    const result = spawnSync("python", ["-m", "msra_codegen", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const apiTestText = readFileSync(path.join(outputDir, "tests", "api_test.py"), "utf8");
    assert.match(apiTestText, /async def test_class_product_feed_smoke\(api, schemashot\):/);
    assert.match(apiTestText, /schemashot/);
    assert.match(apiTestText, /response\.text/);
    assert.match(apiTestText, /assert_json_match\(text, 'ClassProduct\.feed\.smoke'\)/);
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
