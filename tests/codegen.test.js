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

const BLACK_LOGO_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR4nGNgwAH+QzEDEy4VcAAAUjYCAcOOWeoAAAAASUVORK5CYII=";
const WHITE_LOGO_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGNgwAb+QwGIzYRVBTIAAFNDB/vcADVUAAAAAElFTkSuQmCC";
const COLORED_LOGO_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGElEQVR4nGNgwAb+MzD8B2EQmwmrCmQAAKneA//Q/YnfAAAAAElFTkSuQmCC";

function writeLogoFixture(filePath) {
  writeFileSync(filePath, Buffer.from(BLACK_LOGO_PNG_BASE64, "base64"));
}

function writeWhiteLogoFixture(filePath) {
  writeFileSync(filePath, Buffer.from(WHITE_LOGO_PNG_BASE64, "base64"));
}

function writeColoredLogoFixture(filePath) {
  writeFileSync(filePath, Buffer.from(COLORED_LOGO_PNG_BASE64, "base64"));
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

function buildGeneratedPackageProbeScript(options = {}) {
  const expectGroupFields = options.expectGroupFields !== false;
  const expectedHeadlessDefault = options.expectedHeadlessDefault !== false;
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
    "class WarmupError(RuntimeError):",
    "    pass",
    "",
    "",
    "class MethodPipelineError(RuntimeError):",
    "    pass",
    "",
    "",
    "def autotest(func):",
    "    return func",
    "",
    "class BaseModel:",
    "    def __init__(self, **kwargs):",
    "        for key, value in kwargs.items():",
    "            setattr(self, key, value)",
    "",
    "    def model_dump(self):",
    "        return dict(self.__dict__)",
    "",
    "",
    "make_module(\"aiohttp_retry\", ExponentialRetry=DummyObject, RetryClient=DummyObject)",
    "make_module(\"camoufox\", AsyncCamoufox=DummyObject, DefaultAddons=types.SimpleNamespace(UBO=object()))",
    "make_module(\"human_requests\", HumanBrowser=DummyObject, HumanContext=DummyObject, HumanPage=DummyObject, autotest=autotest)",
    "@dataclasses.dataclass",
    "class Warmup:",
    "    browser: object",
    "    context: object",
    "    page: object",
    "    sniffer: object | None",
    "    timeout_ms: int",
    "    test_mode: bool",
    "    prefixes: dict[str, str]",
    "",
    "make_module(",
    "    \"human_requests.abstraction\",",
    "    HttpMethod=types.SimpleNamespace(GET=\"GET\", POST=\"POST\", PUT=\"PUT\", PATCH=\"PATCH\", DELETE=\"DELETE\", HEAD=\"HEAD\", OPTIONS=\"OPTIONS\"),",
    "    Output=DummyObject,",
    "    Proxy=DummyProxy,",
    "    Warmup=Warmup,",
    "    WarmupError=WarmupError,",
    "    MethodPipelineError=MethodPipelineError,",
    "    FetchResponse=DummyObject,",
    ")",
    "make_module(\"pydantic\", BaseModel=BaseModel)",
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
    "human_requests_abstraction = sys.modules[\"human_requests.abstraction\"]",
    "client_class_name = pkg.__all__[0]",
    "client_cls = getattr(pkg, client_class_name)",
    "warmup_cls = human_requests_abstraction.Warmup",
    "",
    "assert dataclasses.is_dataclass(client_cls)",
    "assert dataclasses.is_dataclass(warmup_cls)",
    "assert warmup_cls is human_requests_abstraction.Warmup",
    "field_names = [field.name for field in dataclasses.fields(client_cls)]",
    "base_field_names = [\"timeout_ms\", \"headless\", \"test_mode\", \"proxy\", \"browser_opts\"]",
    "assert field_names[:len(base_field_names)] == base_field_names",
    "group_field_names = field_names[len(base_field_names):]",
    ...(expectGroupFields
      ? [
          "assert group_field_names",
        ]
      : []),
    "assert [field.name for field in dataclasses.fields(warmup_cls)] == [\"browser\", \"context\", \"page\", \"sniffer\", \"timeout_ms\", \"test_mode\", \"prefixes\"]",
    "",
    "instance = client_cls(proxy=None, browser_opts=None)",
    "assert instance.proxy is DummyProxy.env_sentinel",
    "assert instance.browser_opts == {}",
    "assert instance.timeout_ms == client_cls.__dataclass_fields__[\"timeout_ms\"].default",
    `assert instance.headless is ${expectedHeadlessDefault ? "True" : "False"}`,
    ...(expectGroupFields
      ? [
          "for field_name in group_field_names:",
          "    assert field_name in instance.__dict__",
          "    group = getattr(instance, field_name)",
          "    assert instance.__dict__[field_name] is group",
          "    assert getattr(group, \"_parent\", None) is instance",
        ]
      : []),
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
    const result = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const packageDir = path.join(outputDir, packageName);
    const managerText = readFileSync(path.join(outputDir, packageName, "manager.py"), "utf8");
    assert.match(managerText, /from \.pipelines\.warmup import pipeline as warmup_runner/);
    assert.match(managerText, /await warmup_runner\(warmup\)/);
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
    const result = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const managerText = readFileSync(path.join(outputDir, packageName, "manager.py"), "utf8");
    assert.doesNotMatch(managerText, /""""""/);
    assert.match(managerText, /class OzonAPI:\r?\n\s+timeout_ms: int = 35000/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("generator copies black app logo and emits automatic dark mode variants", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-logo-"));
  const inputPath = path.join(workDir, "logo.msra");
  const outputDir = path.join(workDir, "generated");
  const packageName = "logo_api";
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const logoPath = path.join(workDir, "logo.png");
  writeLogoFixture(logoPath);
  const text = [
    "[app]",
    'name="LogoAPI"',
    'package_name="logo_api"',
    'logo="./logo.png"',
    'description="Logo docs project"',
    "",
  ].join("\n");

  try {
    writeFileSync(inputPath, text, "utf8");
    const result = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const confText = readFileSync(path.join(outputDir, "docs", "source", "conf.py"), "utf8");
    const logoLightPath = path.join(outputDir, "docs", "source", "_static", "logo-light.webp");
    const logoDarkPath = path.join(outputDir, "docs", "source", "_static", "logo-dark.webp");
    assert.match(confText, /"light_logo": "logo-light\.webp"/);
    assert.match(confText, /"dark_logo": "logo-dark\.webp"/);
    assert.ok(existsSync(logoLightPath), "expected light logo asset to be generated");
    assert.ok(existsSync(logoDarkPath), "expected dark logo asset to be generated");

    const inspectLogoScript = [
      "from PIL import Image",
      "import sys",
      "for path in sys.argv[1:]:",
      "    image = Image.open(path).convert('RGBA')",
      "    center = image.getpixel((1, 1))",
      "    corner = image.getpixel((0, 0))",
      "    print(f\"{center}|{corner}\")",
    ].join("\n");
    const inspectResult = spawnSync(
      "python",
      ["-c", inspectLogoScript, logoLightPath, logoDarkPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    assert.strictEqual(inspectResult.status, 0, inspectResult.stderr || inspectResult.stdout);
    const [lightPixel, darkPixel] = normalizeNewlines(inspectResult.stdout).trim().split("\n");
    assert.strictEqual(lightPixel, "(0, 0, 0, 255)|(0, 0, 0, 0)");
    assert.strictEqual(darkPixel, "(255, 255, 255, 255)|(255, 255, 255, 0)");

    const docsBuildDir = buildSphinxTextDocs(outputDir, repoRoot);
    assert.ok(existsSync(path.join(docsBuildDir, "_api", `${packageName}.manager.txt`)));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("generator copies white app logo and normalizes it to automatic dark mode variants", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-logo-white-"));
  const inputPath = path.join(workDir, "logo.msra");
  const outputDir = path.join(workDir, "generated");
  const packageName = "logo_api";
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const logoPath = path.join(workDir, "logo.png");
  writeWhiteLogoFixture(logoPath);
  const text = [
    "[app]",
    'name="LogoAPI"',
    'package_name="logo_api"',
    'logo="./logo.png"',
    'description="Logo docs project"',
    "",
  ].join("\n");

  try {
    writeFileSync(inputPath, text, "utf8");
    const result = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const logoLightPath = path.join(outputDir, "docs", "source", "_static", "logo-light.webp");
    const logoDarkPath = path.join(outputDir, "docs", "source", "_static", "logo-dark.webp");
    const inspectLogoScript = [
      "from PIL import Image",
      "import sys",
      "for path in sys.argv[1:]:",
      "    image = Image.open(path).convert('RGBA')",
      "    center = image.getpixel((1, 1))",
      "    corner = image.getpixel((0, 0))",
      "    print(f\"{center}|{corner}\")",
    ].join("\n");
    const inspectResult = spawnSync(
      "python",
      ["-c", inspectLogoScript, logoLightPath, logoDarkPath],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    assert.strictEqual(inspectResult.status, 0, inspectResult.stderr || inspectResult.stdout);
    const [lightPixel, darkPixel] = normalizeNewlines(inspectResult.stdout).trim().split("\n");
    assert.strictEqual(lightPixel, "(0, 0, 0, 255)|(255, 255, 255, 0)");
    assert.strictEqual(darkPixel, "(255, 255, 255, 255)|(0, 0, 0, 0)");

    const docsBuildDir = buildSphinxTextDocs(outputDir, repoRoot);
    assert.ok(existsSync(path.join(docsBuildDir, "_api", `${packageName}.manager.txt`)));
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("generator rejects colored app logos", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-logo-colored-"));
  const inputPath = path.join(workDir, "logo.msra");
  const outputDir = path.join(workDir, "generated");
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const logoPath = path.join(workDir, "logo.png");
  writeColoredLogoFixture(logoPath);
  const text = [
    "[app]",
    'name="LogoAPI"',
    'package_name="logo_api"',
    'logo="./logo.png"',
    'description="Logo docs project"',
    "",
  ].join("\n");

  try {
    writeFileSync(inputPath, text, "utf8");
    const result = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    const combinedOutput = `${result.stdout || ""}${result.stderr || ""}`;

    assert.notStrictEqual(result.status, 0, "expected codegen to fail for a colored logo");
    assert.match(combinedOutput, /app\.logo must be a monochrome black-and-white raster image/);
    assert.match(combinedOutput, /colored pixel at \(\d+, \d+\)/);
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
        ["-m", "msra_codegen", "generate", testCase.inputPath, "-o", testCase.outputDir],
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
      const docsRequirementsText = readFileSync(path.join(testCase.outputDir, "docs", "requirements.txt"), "utf8");
      const docsConfText = readFileSync(path.join(testCase.outputDir, "docs", "source", "conf.py"), "utf8");
      const pyprojectText = readFileSync(path.join(testCase.outputDir, "pyproject.toml"), "utf8");
      const requirementsText = readFileSync(path.join(testCase.outputDir, "requirements.txt"), "utf8");
      const requirementsDevText = readFileSync(path.join(testCase.outputDir, "requirements-dev.txt"), "utf8");
      const licenseText = readFileSync(path.join(testCase.outputDir, "LICENSE"), "utf8");
      const packageDir = path.join(testCase.outputDir, testCase.packageName);
      const testsDir = path.join(testCase.outputDir, "tests");
      const conftestText = readFileSync(path.join(testsDir, "conftest.py"), "utf8");
      const apiTestText = readFileSync(path.join(testsDir, "api_test.py"), "utf8");
      const readmePipelineCode = extractMarkdownCodeFence(readmeText);
      const quickStartPipelineCode = extractRstPythonCodeBlock(quickStartText);
      assert.match(readmeText, /# Usage/);
      assert.match(readmeText, /### Принцип работы/);
      assert.match(readmeText, /Ozon API integration for catalog browsing and cart flows/);
      assert.match(pyprojectText, /^description = "Ozon API integration for catalog browsing and cart flows"$/m);
      assert.match(readmeText, /```py[\s\S]*async def main\(\):/);
      assert.doesNotMatch(readmeText, /examples\/pipeline\.py/);
      assert.ok(readmePipelineCode, "expected README to contain a python code block");
      assert.ok(quickStartPipelineCode, "expected quick_start.rst to contain a python code block");
      assert.match(quickStartText, /The public API is documented in :doc:`api`\./);
      assert.match(docsRequirementsText, /jsoncrack-for-sphinx/);
      assert.match(docsConfText, /"jsoncrack_for_sphinx"/);
      assert.match(docsConfText, /"human_requests": \("https:\/\/miskler\.github\.io\/human-requests\/", None\)/);
      assert.match(docsConfText, /json_schema_dir = str\(HERE\.parents\[2\] \/ "tests" \/ "__snapshots__"\)/);
      assert.match(readmeText, new RegExp(`https://github\\.com/${testCase.packageOwner}/${testCase.packageName}`));
      assert.match(readmeText, new RegExp(`https://${testCase.packageOwner.toLowerCase()}\\.github\\.io/${testCase.packageName}/quick_start`));
      assert.match(readmeText, new RegExp(`https://pypi\\.org/project/${testCase.packageName.replaceAll("_", "-")}/`));
      assert.match(readmeText, new RegExp(`https://img\\.shields\\.io/github/license/${testCase.packageOwner}/${testCase.packageName}`));
      assert.match(quickStartText, /.. code-block:: python[\s\S]*async def main\(\):/);
      assert.match(exampleText, /async def main\(\):/);
      assert.match(exampleText, /async with [A-Za-z0-9_]+\(\) as api:/);
      assert.doesNotMatch(exampleText, /\bpass\b/);
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
      assert.match(pyprojectText, /\[tool\.ruff\]/);
      assert.match(pyprojectText, /line-length = 200/);
      assert.match(pyprojectText, /\[tool\.ruff\.lint\]/);
      assert.match(pyprojectText, /select = \[/);
      assert.match(pyprojectText, /ignore = \[/);
      assert.match(pyprojectText, /\[tool\.mypy\]/);
      assert.match(pyprojectText, /ignore_missing_imports = true/);
      assert.match(pyprojectText, /Programming Language :: Python :: 3/);
      assert.match(pyprojectText, /Programming Language :: Python :: 3\.10/);
      assert.match(pyprojectText, /Programming Language :: Python :: 3\.13/);
      assert.doesNotMatch(pyprojectText, /Programming Language :: Python :: 3\.14/);
      assert.match(pyprojectText, /Operating System :: Microsoft :: Windows/);
      assert.match(pyprojectText, /Topic :: Utilities/);
      assert.strictEqual(
        normalizeNewlines(requirementsDevText).trimEnd(),
        [
          "-r requirements.txt",
          "-r docs/requirements.txt",
          "pytest",
          "pytest-anyio",
          "pytest-jsonschema-snapshot",
          "ruff",
          "mypy",
        ].join("\n"),
      );
      assert.ok(existsSync(path.join(testsDir, "__snapshots__")), "expected tests/__snapshots__ to be generated");
      assert.match(conftestText, /def anyio_backend\(\):/);
      assert.match(conftestText, /async def api\(\):/);
      assert.doesNotMatch(conftestText, /abstraction/);
      assert.match(apiTestText, /from human_requests import autotest_data, autotest_depends_on, autotest_hook, autotest_params/);
      assert.match(apiTestText, /from human_requests\.autotest import AutotestCallContext/);
      assert.match(apiTestText, /from human_requests\.autotest import .*AutotestDataContext/);
      assert.doesNotMatch(apiTestText, /abstraction/);
      const probeResult = spawnSync(
        "python",
        [
          "-c",
          buildGeneratedPackageProbeScript(),
          testCase.outputDir,
          testCase.packageName,
        ],
        {
          cwd: repoRoot,
          env: buildCodegenPythonPath(pythonReleasesFixturePath),
          encoding: "utf8",
        },
      );
      assert.strictEqual(probeResult.status, 0, probeResult.stderr || probeResult.stdout);
      const packageNameSlug = testCase.packageName.replace(/_/g, "-");
      const makefileText = readFileSync(path.join(testCase.outputDir, "Makefile"), "utf8");
      const sourceSyncWorkflowText = readFileSync(
        path.join(testCase.outputDir, ".github", "workflows", "source-sync.yml"),
        "utf8",
      );
      const testsWorkflowText = readFileSync(
        path.join(testCase.outputDir, ".github", "workflows", "tests.yml"),
        "utf8",
      );
      const publishWorkflowText = readFileSync(
        path.join(testCase.outputDir, ".github", "workflows", "publish.yml"),
        "utf8",
      );
      const normalizedSourceSyncWorkflowText = normalizeNewlines(sourceSyncWorkflowText);
      const normalizedPublishWorkflowText = normalizeNewlines(publishWorkflowText);
      const gitignoreText = readFileSync(path.join(testCase.outputDir, ".gitignore"), "utf8");
      assert.match(makefileText, /pip install -r requirements-dev\.txt/);
      assert.match(makefileText, new RegExp(`pytest --cov=${testCase.packageName}`));
      assert.match(makefileText, new RegExp(`python -m ruff check ${testCase.packageName} tests example\\.py docs/source/conf\\.py`));
      assert.match(makefileText, new RegExp(`python -m ruff check --select I --fix ${testCase.packageName} tests example\\.py docs/source/conf\\.py`));
      assert.match(makefileText, new RegExp(`python -m ruff format ${testCase.packageName} tests example\\.py docs/source/conf\\.py`));
      assert.match(makefileText, new RegExp(`python -m mypy ${testCase.packageName}`));
      assert.match(gitignoreText, /^# Python bytecode$/m);
      assert.match(gitignoreText, /^__pycache__\/$/m);
      assert.match(gitignoreText, /^\.pytest_cache\/$/m);
      assert.match(gitignoreText, /^merged\.msra$/m);
      assert.match(gitignoreText, /^docs\/_build\/$/m);
      assert.match(normalizedSourceSyncWorkflowText, /name: source-sync/);
      assert.match(normalizedSourceSyncWorkflowText, /workflow_dispatch:/);
      assert.match(normalizedSourceSyncWorkflowText, /uses: actions\/checkout@v4/);
      assert.match(normalizedSourceSyncWorkflowText, /uses: actions\/setup-python@v5/);
      assert.match(normalizedSourceSyncWorkflowText, /repository: "Miskler\/engine-reverse-ide"/);
      assert.match(normalizedSourceSyncWorkflowText, /repository: \$\{\{ github\.repository \}\}/);
      assert.match(normalizedSourceSyncWorkflowText, /path: logic/);
      assert.match(normalizedSourceSyncWorkflowText, /path: source/);
      assert.match(normalizedSourceSyncWorkflowText, /path: target/);
      assert.match(normalizedSourceSyncWorkflowText, new RegExp(`source_msra_path="${path.basename(testCase.inputPath)}"`));
      assert.match(normalizedSourceSyncWorkflowText, /python -m msra_codegen generate "\.\.\/source\/\$source_msra_path" -o \.\.\/generated/);
      assert.match(normalizedSourceSyncWorkflowText, /working-directory: target/);
      assert.match(normalizedSourceSyncWorkflowText, /python -m pip install -r requirements-dev\.txt/);
      assert.match(normalizedSourceSyncWorkflowText, /token: \$\{\{ secrets\.SOURCE_SYNC_TOKEN \}\}/);
      assert.match(normalizedSourceSyncWorkflowText, /git push origin HEAD:main/);
      assert.match(testsWorkflowText, /name: tests/);
      assert.match(testsWorkflowText, /uses: actions\/checkout@v4/);
      assert.match(testsWorkflowText, /pip install -r requirements-dev\.txt/);
      assert.match(testsWorkflowText, /uses: Miskler\/human-requests-bot@v11/);
      assert.match(testsWorkflowText, /uses: Miskler\/pytest-jsonschema-snapshot-bot@v14/);
      assert.match(normalizedPublishWorkflowText, /push:\n\s+branches:\n\s+- main/);
      assert.match(normalizedPublishWorkflowText, /github\.event_name == 'push'/);
      assert.match(normalizedPublishWorkflowText, /uses: \.\/\.github\/workflows\/tests\.yml/);
      assert.match(normalizedPublishWorkflowText, /uses: actions\/upload-pages-artifact@v3/);
      assert.match(normalizedPublishWorkflowText, /uses: actions\/deploy-pages@v4/);
      assert.match(normalizedPublishWorkflowText, /uses: pypa\/gh-action-pypi-publish@release\/v1/);
      assert.match(normalizedPublishWorkflowText, new RegExp(`https://pypi\\.org/project/${packageNameSlug}/`));
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
      assert.match(readmeText, /Пример поиска по одному запросу/);
      assert.match(readmeText, /smoke = \(await api\.Catalog\.Product\.feed\(query="example"\)\)\.json\(\)/);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("source sync workflow preserves target artifacts from app.sync", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-source-sync-preserve-"));
  const inputPath = path.join(workDir, "sync.msra");
  const outputDir = path.join(workDir, "generated");
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const source = normalizeNewlines(readFileSync(path.join(repoRoot, "examples", "example", "example.msra"), "utf8"))
    .replace('package_name="ozon_api"', 'package_name="sync_api"')
    .replace(
      /\n\[app\.warmup\]\n/,
      '\n[app.sync]\npreserved_target_paths=["tests/__snapshots__"]\nignored_generated_patterns=["**/__pycache__", "**/*.pyc"]\n\n[app.warmup]\n',
    );

  try {
    writeFileSync(inputPath, source, "utf8");
    writeFileSync(
      path.join(workDir, "warmup.py"),
      readFileSync(path.join(repoRoot, "examples", "example", "warmup.py"), "utf8"),
      "utf8",
    );
    const result = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const sourceSyncWorkflowText = normalizeNewlines(
      readFileSync(path.join(outputDir, ".github", "workflows", "source-sync.yml"), "utf8"),
    );
    assert.match(sourceSyncWorkflowText, /preserve_paths = \["tests\/__snapshots__"\]/);
    assert.match(sourceSyncWorkflowText, /ignored_patterns = \["\*\*\/__pycache__", "\*\*\/\*\.pyc"\]/);
    assert.match(sourceSyncWorkflowText, /Restore preserved artifacts and remove generated noise/);
    assert.ok(
      sourceSyncWorkflowText.indexOf("Validate generated project") < sourceSyncWorkflowText.indexOf("Restore preserved artifacts and remove generated noise"),
      "expected preserved artifacts to be restored after validate",
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("python codegen builds the TODO/2 abstractions project", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-abstractions-build-"));
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const outputDir = path.join(workDir, "generated");

  try {
    const generateResult = spawnSync(
      "python",
      ["-m", "msra_codegen", "generate", path.join(repoRoot, "TODO", "2", "example.msra"), "-o", outputDir],
      {
        cwd: repoRoot,
        env: buildCodegenPythonPath(pythonReleasesFixturePath),
        encoding: "utf8",
      },
    );
    assert.strictEqual(generateResult.status, 0, generateResult.stderr || generateResult.stdout);

    const validateResult = spawnSync("python", ["-m", "msra_codegen", "validate", outputDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.strictEqual(validateResult.status, 0, validateResult.stderr || validateResult.stdout);

    const probeScript = [
      buildGeneratedPackageProbeScript({ expectGroupFields: false }),
      "",
      "import asyncio",
      "from urllib.parse import parse_qs, urlsplit",
      "",
      "class OutputRecorder:",
      "    calls = []",
      "",
      "    @staticmethod",
      "    def from_fetch_response(resp, **kwargs):",
        "        OutputRecorder.calls.append({\"resp\": resp, \"kwargs\": kwargs})",
        "        return {\"resp\": resp, \"kwargs\": kwargs}",
      "",
      "class DummyResponse:",
      "    def __init__(self, *, url=\"https://example.test\", headers=None, status=200, reason=\"OK\", history=None):",
      "        self.url = url",
      "        self.headers = {} if headers is None else headers",
      "        self.status = status",
      "        self.reason = reason",
      "        self.history = [] if history is None else history",
      "",
      "    async def read(self):",
      "        return b\"\"",
      "",
      "class DummyPage:",
      "    def __init__(self):",
      "        self.fetch_calls = []",
      "",
      "    async def fetch(self, **kwargs):",
      "        self.fetch_calls.append(kwargs)",
      "        return DummyResponse(url=kwargs.get(\"url\", \"https://example.test\"))",
      "",
      "async def main():",
      "    abstraction = pkg.abstraction",
      "    assert pkg.__all__ == [\"FixPriceAPI\"]",
      "    assert hasattr(pkg, \"FixPriceAPI\")",
      "    assert hasattr(abstraction, \"CatalogFeedSort\")",
      "    assert hasattr(abstraction, \"BannerPlace\")",
      "    assert abstraction.validate_allowed_value(abstraction.CatalogFeedSort.Price.ASC, abstraction.CatalogFeedSort) == {\"orderBy\": \"price\", \"orderDirection\": \"asc\"}",
      "    assert abstraction.validate_allowed_value(abstraction.BannerPlace.MAIN_BANNERS, abstraction.BannerPlace) == \"main_web_banners\"",
      "    try:",
      "        abstraction.validate_allowed_value(abstraction.CatalogFeedSort, abstraction.CatalogFeedSort)",
      "    except ValueError as exc:",
      "        assert \"value registry, not a value\" in str(exc)",
      "    else:",
      "        raise AssertionError(\"expected registry validation error\")",
      "    client = instance",
      "    assert client._parent is client",
      "    client.page = DummyPage()",
      "    OutputRecorder.calls.clear()",
      "    abstraction.Output = OutputRecorder",
      "    result = await client.info(",
      "        feed_sort=abstraction.CatalogFeedSort.Price.ASC,",
      "        place=abstraction.BannerPlace.MAIN_BANNERS,",
      "    )",
      "    parsed_url = urlsplit(result[\"resp\"].url)",
      "    assert parsed_url.path == \"/catalog/\"",
      "    assert len(client.page.fetch_calls) == 1",
      "    fetch_call = client.page.fetch_calls[0]",
      "    parsed = parse_qs(urlsplit(fetch_call[\"url\"]).query)",
      "    assert parsed == {\"sort\": [\"price\"], \"order\": [\"asc\"], \"place\": [\"main_web_banners\"]}",
      "    assert OutputRecorder.calls and OutputRecorder.calls[0][\"kwargs\"] == {}",
      "",
      "asyncio.run(main())",
    ].join("\n");

    const probeResult = spawnSync(
      "python",
      ["-c", probeScript, outputDir, "fixprice_api"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    assert.strictEqual(probeResult.status, 0, probeResult.stderr || probeResult.stdout);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("python codegen builds the demo project", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-demo-build-"));
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const outputDir = path.join(workDir, "generated");

  try {
    const generateResult = spawnSync(
      "python",
      ["-m", "msra_codegen", "generate", path.join(repoRoot, "examples", "demo", "demo.msra"), "-o", outputDir],
      {
        cwd: repoRoot,
        env: buildCodegenPythonPath(pythonReleasesFixturePath),
        encoding: "utf8",
      },
    );
    assert.strictEqual(generateResult.status, 0, generateResult.stderr || generateResult.stdout);

    const validateResult = spawnSync("python", ["-m", "msra_codegen", "validate", outputDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.strictEqual(validateResult.status, 0, validateResult.stderr || validateResult.stdout);

    const readmeText = readFileSync(path.join(outputDir, "README.md"), "utf8");
    const testsWorkflowText = normalizeNewlines(
      readFileSync(path.join(outputDir, ".github", "workflows", "tests.yml"), "utf8"),
    );
    assert.match(
      readmeText,
      /\[!\[Ruff\]\(https:\/\/img\.shields\.io\/badge\/linting-Ruff-blue\?logo=ruff&logoColor=white\)\]\(https:\/\/github\.com\/astral-sh\/ruff\)/,
    );
    assert.match(testsWorkflowText, /xvfb-run -a bash -e -lc "\$MSRA_RUN_COMMANDS"/);

    const probeScript = [
      buildGeneratedPackageProbeScript({ expectedHeadlessDefault: false }),
      "",
      "import asyncio",
      "",
      "async def main():",
      "    client = instance",
      "    client.headless = True",
      "    try:",
      "        await client._warmup()",
      "    except ValueError as exc:",
      '        assert "headless=True" in str(exc)',
      "    else:",
      '        raise AssertionError("expected headless mode to be rejected")',
      "",
      "asyncio.run(main())",
    ].join("\n");

    const probeResult = spawnSync(
      "python",
      ["-c", probeScript, outputDir, "demo_api"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );
    assert.strictEqual(probeResult.status, 0, probeResult.stderr || probeResult.stdout);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("python codegen supports one-sided numeric match bounds on variables", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-match-bounds-"));
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const outputDir = path.join(workDir, "generated");
  const source = normalizeNewlines(readFileSync(path.join(repoRoot, "examples", "example", "example.msra"), "utf8"))
    .replace(
      /from=<UNSTANDARD_HEADERS\.REQUEST\.x-city>.*\n/,
      [
        'from=<UNSTANDARD_HEADERS.REQUEST.x-city> # доступно так же "value" или <LOCAL_STORAGE.x-city> или COOKIES так же можно указать COOKIES.key если по факту хранилище это список/словарь (опасно - если нет, runtime ошибка распарса json)',
        "",
        "[app.variables.lower_bound]",
        'types=[{"type"=integer, "match"={from=1}}]',
        'description="Lower bound value"',
        "from=1",
        "",
        "[app.variables.upper_bound]",
        'types=[{"type"=integer, "match"={to=1}}]',
        'description="Upper bound value"',
        "from=1",
        "",
      ].join("\n"),
    );

  try {
    const inputPath = path.join(workDir, "match-bounds.msra");
    writeFileSync(inputPath, source, "utf8");
    writeFileSync(
      path.join(workDir, "warmup.py"),
      readFileSync(path.join(repoRoot, "examples", "example", "warmup.py"), "utf8"),
      "utf8",
    );
    const generateResult = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(generateResult.status, 0, generateResult.stderr || generateResult.stdout);

    const probeScript = [
      buildGeneratedPackageProbeScript(),
      "",
      "instance.lower_bound = 1",
      "instance.upper_bound = 1",
      "instance.lower_bound = 2",
      "try:",
      "    instance.lower_bound = 0",
      "except ValueError as exc:",
      '    assert "greater than or equal to" in str(exc)',
      "else:",
      '    raise AssertionError("expected lower_bound to reject values below the lower bound")',
      "instance.upper_bound = 0",
      "try:",
      "    instance.upper_bound = 2",
      "except ValueError as exc:",
      '    assert "less than or equal to" in str(exc)',
      "else:",
      '    raise AssertionError("expected upper_bound to reject values above the upper bound")',
    ].join("\n");

    const probeResult = spawnSync("python", ["-c", probeScript, outputDir, "ozon_api"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.strictEqual(probeResult.status, 0, probeResult.stderr || probeResult.stdout);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("python codegen supports one-sided numeric match bounds on function inputs", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-match-inputs-"));
  const inputPath = path.join(workDir, "match-inputs.msra");
  const outputDir = path.join(workDir, "generated");
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const text = [
    "[app]",
    'name="MatchInputAPI"',
    'package_name="match_input_api"',
    'version="0.1.0"',
    "browser=camoufox",
    "",
    "[app.func.HEALTH]",
    'name="health"',
    "transport=fetch",
    "method=GET",
    "",
    "[app.func.HEALTH.url]",
    'base="https://example.test/health"',
    "",
    "[app.func.HEALTH.input.lower_limit]",
    "type=integer",
    "match={from=1}",
    "",
    "[app.func.HEALTH.input.upper_limit]",
    "type=integer",
    "match={to=1}",
    "",
  ].join("\n");

  try {
    writeFileSync(inputPath, text, "utf8");
    const generateResult = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(generateResult.status, 0, generateResult.stderr || generateResult.stdout);

    const probeScript = [
      buildGeneratedPackageProbeScript({ expectGroupFields: false }),
      "",
      "import asyncio",
      "",
      "async def main():",
      "    captured = {}",
      "",
      "    async def dummy_request(method, url, **kwargs):",
      "        captured['method'] = method",
      "        captured['url'] = url",
      "        captured['kwargs'] = kwargs",
      "        return {'method': method, 'url': url, 'kwargs': kwargs}",
      "",
      "    instance._request = dummy_request",
      "    result = await instance.health(lower_limit=2, upper_limit=0)",
      "    assert result['url'] == 'https://example.test/health'",
      "    assert captured['url'] == 'https://example.test/health'",
      "    try:",
      "        await instance.health(lower_limit=0, upper_limit=0)",
      "    except ValueError as exc:",
      '        assert "greater than or equal to" in str(exc)',
      "    else:",
      '        raise AssertionError("expected lower_limit to reject values below the lower bound")',
      "    try:",
      "        await instance.health(lower_limit=2, upper_limit=2)",
      "    except ValueError as exc:",
      '        assert "less than or equal to" in str(exc)',
      "    else:",
      '        raise AssertionError("expected upper_limit to reject values above the upper bound")',
      "",
      "asyncio.run(main())",
    ].join("\n");

    const probeResult = spawnSync("python", ["-c", probeScript, outputDir, "match_input_api"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.strictEqual(probeResult.status, 0, probeResult.stderr || probeResult.stdout);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("python codegen omits query param assembly when a method has no query params", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-noquery-build-"));
  const inputPath = path.join(workDir, "noquery.msra");
  const outputDir = path.join(workDir, "generated");
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const text = [
    "[app]",
    'name="NoQueryAPI"',
    'package_name="no_query_api"',
    'version="0.1.0"',
    "browser=camoufox",
    "",
    "[app.func.HEALTH]",
    'name="health"',
    "transport=fetch",
    "method=GET",
    "",
    "[app.func.HEALTH.url]",
    'base="https://example.test/health"',
    "",
  ].join("\n");

  try {
    writeFileSync(inputPath, text, "utf8");
    const generateResult = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(generateResult.status, 0, generateResult.stderr || generateResult.stdout);

    const validateResult = spawnSync("python", ["-m", "msra_codegen", "validate", outputDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.strictEqual(validateResult.status, 0, validateResult.stderr || validateResult.stdout);

    const probeScript = [
      buildGeneratedPackageProbeScript({ expectGroupFields: false }),
      "",
      "import asyncio",
      "",
      "async def main():",
      "    captured = {}",
      "",
      "    async def dummy_request(method, url, **kwargs):",
      "        captured['method'] = method",
      "        captured['url'] = url",
      "        captured['kwargs'] = kwargs",
      "        return {'method': method, 'url': url, 'kwargs': kwargs}",
      "",
      "    assert instance._parent is instance",
      "    instance._request = dummy_request",
      "    result = await instance.health()",
      "    assert str(captured['method']).endswith('GET')",
      "    assert captured['url'] == 'https://example.test/health'",
      "    assert captured['kwargs'].get('json_body') is None",
      "    assert result['url'] == 'https://example.test/health'",
      "",
      "asyncio.run(main())",
    ].join("\n");

    const probeResult = spawnSync("python", ["-c", probeScript, outputDir, "no_query_api"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    assert.strictEqual(probeResult.status, 0, probeResult.stderr || probeResult.stdout);
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
    const result = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const apiTestText = readFileSync(path.join(outputDir, "tests", "api_test.py"), "utf8");
    assert.match(apiTestText, /async def test_class_product_feed_smoke\(api, schemashot\):/);
    assert.match(apiTestText, /schemashot/);
    assert.match(apiTestText, /response\.text/);
    assert.match(apiTestText, /assert_json_match\(text, "ClassProduct\.feed\.smoke"\)/);
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
    const result = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
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

test("github issue templates are generated from app.issue_templates", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const workDir = mkdtempSync(path.join(os.tmpdir(), "msra-issue-templates-"));
  const inputPath = path.join(workDir, "issue-templates.msra");
  const outputDir = path.join(workDir, "generated");
  const pythonReleasesFixturePath = createPythonReleasesApiFixture(workDir);
  const source = normalizeNewlines(readFileSync(path.join(repoRoot, "examples", "example", "example.msra"), "utf8"))
    .replace(
      '@BlockImages # по умолч false',
      [
        '@BlockImages # по умолч false',
        "",
        "[app.issue_templates]",
        "blank_issues_enabled=false",
        'assignee="miskler"',
        'contact_links=[',
        '  { name="📖  Read the docs", url="https://open-inflation.github.io/chizhik_api/quick_start.html", about="Start here for “how-to” questions." },',
        '  { name="💬  Discord server (Discussions)", url="https://discord.gg/UnJnGHNbBp", about="General Q&A and community support." }',
        "]",
        "",
        "[app.issue_templates.bug_report]",
        'name="🐛 Bug report"',
        'description="Report something that isn’t working as intended"',
        'title="[Bug] <short title>"',
        'labels=["bug"]',
        "",
        "[app.issue_templates.documentation_issue]",
        'name="📚 Docs issue"',
        'description="Flag inaccurate or missing documentation"',
        'title="[Docs] <short title>"',
        'labels=["documentation"]',
        "",
        "[app.issue_templates.feature_request]",
        'name="✨ Feature request"',
        'description="Suggest an idea to improve the project"',
        'title="[Feature] <short title>"',
        'labels=["feature", "enhancement"]',
        "",
      ].join("\n"),
    );

  try {
    writeFileSync(inputPath, source, "utf8");
    writeFileSync(
      path.join(workDir, "warmup.py"),
      readFileSync(path.join(repoRoot, "examples", "example", "warmup.py"), "utf8"),
      "utf8",
    );
    const result = spawnSync("python", ["-m", "msra_codegen", "generate", inputPath, "-o", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const issueTemplatesDir = path.join(outputDir, ".github", "ISSUE_TEMPLATE");
    assert.ok(existsSync(issueTemplatesDir), "expected GitHub issue templates directory to be generated");

    const configText = readFileSync(path.join(issueTemplatesDir, "config.yml"), "utf8");
    const bugReportText = readFileSync(path.join(issueTemplatesDir, "bug_report.yml"), "utf8");
    const docsIssueText = readFileSync(path.join(issueTemplatesDir, "documentation_issue.yml"), "utf8");
    const featureRequestText = readFileSync(path.join(issueTemplatesDir, "feature_request.yml"), "utf8");

    assert.match(configText, /blank_issues_enabled: false/);
    assert.match(configText, /name: "📖  Read the docs"/);
    assert.match(configText, /url: "https:\/\/open-inflation\.github\.io\/chizhik_api\/quick_start\.html"/);
    assert.match(configText, /name: "💬  Discord server \(Discussions\)"/);
    assert.match(bugReportText, /assignees: \["miskler"\]/);
    assert.match(bugReportText, /labels: \["bug"\]/);
    assert.match(docsIssueText, /labels: \["documentation"\]/);
    assert.match(featureRequestText, /labels: \["feature", "enhancement"\]/);
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
      ["-m", "msra_codegen", "generate", fixture.parentPath, "-o", outputDir, "--no-cleanup"],
      {
        cwd: repoRoot,
        env: buildCodegenPythonPath(pythonReleasesFixturePath),
        encoding: "utf8",
      },
    );

    assert.strictEqual(result.status, 0, result.stderr || result.stdout);
    const validateResult = spawnSync("python", ["-m", "msra_codegen", "validate", outputDir], {
      cwd: repoRoot,
      env: buildCodegenPythonPath(pythonReleasesFixturePath),
      encoding: "utf8",
    });
    assert.strictEqual(validateResult.status, 0, validateResult.stderr || validateResult.stdout);
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
