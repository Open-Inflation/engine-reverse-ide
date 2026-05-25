const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } = require("node:fs");
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
  const cases = [
    {
      inputPath: path.join(repoRoot, "examples", "example.msra"),
      outputDir: path.join(workDir, "example"),
      packageName: "ozon_api",
      license: "GPL-3.0-or-later",
    },
    {
      inputPath: path.join(repoRoot, "examples", "fixprice", "fixprice.msra"),
      outputDir: path.join(workDir, "fixprice"),
      packageName: "fixprice_api",
      license: "MIT",
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
  cases.push({
    inputPath: mitInputPath,
    outputDir: path.join(workDir, "mit"),
    packageName: "mit_api",
    license: "MIT",
  });
  cases.push({
    inputPath: delimitedInputPath,
    outputDir: path.join(workDir, "delimited"),
    packageName: "delimited_api",
    license: "GPL-3.0-or-later",
  });

  try {
    for (const testCase of cases) {
      const result = spawnSync(
        "python",
        ["-m", "msra_codegen", testCase.inputPath, "-o", testCase.outputDir],
        {
          cwd: repoRoot,
          encoding: "utf8",
        },
      );
      assert.strictEqual(result.status, 0, result.stderr || result.stdout);
      const mergedCheck = spawnSync("node", [path.join(repoRoot, "bin", "msra.js"), "check", path.join(testCase.outputDir, "merged.msra")], {
        cwd: repoRoot,
        encoding: "utf8",
      });
      assert.strictEqual(mergedCheck.status, 0, mergedCheck.stderr || mergedCheck.stdout);
      const readmeText = readFileSync(path.join(testCase.outputDir, "README.md"), "utf8");
      const pyprojectText = readFileSync(path.join(testCase.outputDir, "pyproject.toml"), "utf8");
      const licenseText = readFileSync(path.join(testCase.outputDir, "LICENSE"), "utf8");
      assert.match(readmeText, /pip install [a-z0-9_]+/i);
      assert.match(readmeText, /async with [A-Za-z0-9_]+\(\) as api:/);
      assert.match(pyprojectText, new RegExp(`^name = "${testCase.packageName}"$`, "m"));
      assert.ok(pyprojectText.includes(`license = "${testCase.license}"`));
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
      if (testCase.packageName === "ozon_api") {
        const productModule = readFileSync(path.join(packageDir, "endpoints", "catalog", "product.py"), "utf8");
        assert.match(productModule, /async def feed\(self, query: str \| None = None, url: list\[Literal\['\/searchSuggestions\/search\/'\]\] \| None = None, filename: str \| None = None\) -> abstraction\.Output:/);
        assert.match(productModule, /request_url = self\._parent\._BASE_API/);
        assert.match(productModule, /if _url_values in \(None, \[\]\):/);
        assert.match(productModule, /query_params\.append\(\('url', ','.join\(str\(__item\) for __item in _url_values\)\)\)/);
        assert.match(productModule, /query_params\.append\(\('from_global', 'true'\)\)/);
      } else if (testCase.packageName === "delimited_api") {
        const productModule = readFileSync(path.join(packageDir, "endpoints", "catalog", "product.py"), "utf8");
        assert.match(productModule, /query_params\.append\(\('url', '\|'\.join\(str\(__item\) for __item in _url_values\)\)\)/);
      } else if (testCase.packageName === "fixprice_api") {
        const productModule = readFileSync(path.join(packageDir, "endpoints", "catalog", "products.py"), "utf8");
        assert.match(productModule, /from \.goto_pipeline import pipeline as goto_pipeline_runner/);
        assert.match(productModule, /await goto_pipeline_runner\(warmup\)/);
        assert.match(productModule, /extractors\/catalog-product-info\.js/);
        assert.match(readmeText, /python -m camoufox fetch/);
        assert.match(readmeText, /Получаем дерево категорий/);
        assert.match(readmeText, /Список товаров в выбранной категории/);
        assert.match(readmeText, /Загрузка изображения по прямой ссылке/);
        assert.match(readmeText, /Image\.open\(image_stream\)/);
        assert.doesNotMatch(readmeText, /Current city_id|api\.city_id =/);
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
      assert.match(managerModule, /if value is None:\s+self\._city_id = None/);
      if (testCase.packageName === "fixprice_api") {
        assert.match(managerModule, /allowed_values = \['store', 'pickup', 'courier'\]/);
        assert.match(managerModule, /if value not in allowed_values:/);
        assert.match(readFileSync(path.join(packageDir, "goto_pipeline.py"), "utf8"), /async def pipeline\(warmup: Warmup\)/);
        assert.match(readFileSync(path.join(packageDir, "extractors", "catalog-product-info.js"), "utf8"), /window\.__NUXT__=/);
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
      encoding: "utf8",
    });
    assert.strictEqual(result.status, 0, result.stderr || result.stdout);

    const readmeText = readFileSync(path.join(outputDir, "README.md"), "utf8");
    assert.match(readmeText, /from PIL import Image/);
    assert.match(readmeText, /image_url = ['"]https:\/\/example\.com\/image\.png['"]/);
    assert.match(readmeText, /image_stream = await api\.General\.fetch_asset\(image_url\)/);
    assert.match(readmeText, /with Image\.open\(image_stream\) as img:/);
    assert.doesNotMatch(readmeText, /download_image/);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("generator writes a merged intermediate msra file", () => {
  const repoRoot = path.resolve(__dirname, "..");
  const fixture = createMultiFileFixture();
  const outputDir = path.join(fixture.tmpDir, "generated");
  try {
    const result = spawnSync("python", ["-m", "msra_codegen.cli", fixture.parentPath, "-o", outputDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });

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
