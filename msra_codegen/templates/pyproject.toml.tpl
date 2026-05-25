[build-system]
requires = ["setuptools>=61.0", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "{{ package_name }}"
dynamic = ["version"]
description = "Generated async Python client from MSRA"
readme = "README.md"
requires-python = ">=3.10"
license = "{{ license }}"
{{ authors_block }}
dependencies = [
    "camoufox[geoip]",
    "human_requests",
    "aiohttp",
    "aiohttp-retry",
    "Pillow"
]

[tool.setuptools]
include-package-data = true

[tool.setuptools.package-data]
{{ package_name }} = ["extractors/*.js", "extractors/**/*.js"]

[tool.setuptools.dynamic]
version = { attr = "{{ package_name }}.__version__" }

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
python_files = ["*_test.py", "*_tests.py"]
filterwarnings = [
    "ignore::pytest.PytestUnraisableExceptionWarning",
    "ignore:Event loop is closed:RuntimeWarning",
]
anyio_mode = "auto"
autotest_start_class = "{{ autotest_start_class }}"
addopts = "-v --tb=short --disable-warnings"
