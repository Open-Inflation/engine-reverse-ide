from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any


def build_project(ast: dict[str, Any], msra_path: Path) -> dict[str, Any]:
    tables = [table for table in ast.get("tables", [])]
    table_index: dict[tuple[str, ...], dict[str, Any]] = {
        tuple(table["path"]): table for table in tables
    }

    def get_table(path: list[str] | tuple[str, ...]) -> dict[str, Any] | None:
        return table_index.get(tuple(path))

    def get_assignment(table: dict[str, Any] | None, key: str, default: Any = None) -> Any:
        if not table:
            return default
        for assignment in table.get("assignments", []):
            if assignment.get("key") == key:
                return assignment.get("value")
        return default

    app_table = get_table(["app"])
    app = {
        "name": str(get_plain_value(get_assignment(app_table, "name", "GeneratedAPI"))),
        "version": str(get_plain_value(get_assignment(app_table, "version", "0.1.0"))),
        "timeout_ms": int(get_plain_value(get_assignment(app_table, "timeout_ms", 35000))),
        "class_name_pattern": str(get_plain_value(get_assignment(app_table, "class_name_pattern", "Class{class_name}"))),
        "browser": str(get_plain_value(get_assignment(app_table, "browser", "camoufox"))),
    }

    prefixes_table = get_table(["app", "prefixes"])
    prefixes = {
        assignment["key"]: get_plain_value(assignment["value"])
        for assignment in (prefixes_table or {}).get("assignments", [])
    }

    regex_tables = [
        table
        for table in tables
        if len(table["path"]) == 3 and table["path"][0] == "app" and table["path"][1] == "regexes"
    ]
    regexes: list[dict[str, Any]] = []
    for table in regex_tables:
        regexes.append(
            {
                "name": table["path"][2],
                "regex": get_plain_value(get_assignment(table, "regex", "")),
                "raise": get_plain_value(get_assignment(table, "raise", "")),
                "description": get_plain_value(get_assignment(table, "description", "")),
            }
        )

    groups_tables = [
        table
        for table in tables
        if len(table["path"]) >= 3 and table["path"][0] == "app" and table["path"][1] == "groups"
    ]
    groups = []
    for table in groups_tables:
        groups.append(
            {
                "path": table["path"][2:],
                "name": ".".join(table["path"][2:]),
                "description": get_plain_value(get_assignment(table, "description", "")),
            }
        )

    headers_table = get_table(["app", "func", "headers"])
    headers_spec = None
    if headers_table:
        headers_spec = {
            "referrer": get_assignment(headers_table, "referrer"),
            "cors_mode": get_plain_value(get_assignment(headers_table, "cors_mode", "cors")),
            "credentials": get_plain_value(get_assignment(headers_table, "credentials", "include")),
            "headers": get_assignment(headers_table, "headers"),
        }

    warmup_table = get_table(["app", "warmup"])
    warmup_spec = None
    if warmup_table:
        warmup_spec = {
            "humanize": bool(get_plain_value(get_assignment(warmup_table, "humanize", False))),
            "block_images": bool(get_plain_value(get_assignment(warmup_table, "block_images", False))),
            "url": get_assignment(warmup_table, "url"),
            "headers_sniffer": bool(get_plain_value(get_assignment(warmup_table, "headers_sniffer", False))),
            "on_error_screenshot_path": get_plain_value(get_assignment(warmup_table, "on_error_screenshot_path", "")),
            "pipeline": get_assignment(warmup_table, "pipeline"),
        }

    variable_tables = [
        table
        for table in tables
        if len(table["path"]) == 3 and table["path"][0] == "app" and table["path"][1] == "variables"
    ]
    variables = []
    for table in variable_tables:
        types_expr = get_assignment(table, "types")
        variables.append(
            {
                "name": table["path"][2],
                "types": types_expr,
                "revalue": extract_variable_revalue(types_expr),
                "read_only": bool(get_plain_value(get_assignment(table, "read_only", False))),
                "from": get_assignment(table, "from"),
                "description": get_plain_value(get_assignment(table, "description", "")),
            }
        )

    functions: list[dict[str, Any]] = []
    for table in tables:
        path = table["path"]
        if len(path) != 3 or path[0] != "app" or path[1] != "func":
            continue
        func_id = path[2]
        if func_id == "headers":
            continue

        root = table
        group = str(get_plain_value(get_assignment(root, "group", "")))
        transport = str(get_plain_value(get_assignment(root, "transport", "fetch")))
        method = str(get_plain_value(get_assignment(root, "method", "GET")))
        functions.append(
            {
                "id": func_id,
                "name": str(get_plain_value(get_assignment(root, "name", func_id.lower()))),
                "group": group,
                "transport": transport,
                "method": method,
                "color": get_plain_value(get_assignment(root, "color", "")),
                "description": str(get_plain_value(get_assignment(root, "description", ""))),
                "root_table": root,
                "inputs": [],
                "url": None,
                "body": None,
                "postprocess": None,
            }
        )

    for func in functions:
        func_id = func["id"]
        prefix = ["app", "func", func_id]
        input_tables = [
            table
            for table in tables
            if len(table["path"]) == 5
            and table["path"][:4] == prefix + ["input"]
        ]
        func["inputs"] = [build_input_spec(table, get_assignment) for table in input_tables]

        url_table = get_table(prefix + ["url"])
        if url_table:
            param_tables = [
                table
                for table in tables
                if len(table["path"]) == 6
                and table["path"][:5] == prefix + ["url", "params"]
            ]
            func["url"] = {
                "base": get_assignment(url_table, "base"),
                "params": [build_url_param_spec(table, get_assignment) for table in param_tables],
            }

        body_table = get_table(prefix + ["body"])
        if body_table:
            func["body"] = {
                "type": str(get_plain_value(get_assignment(body_table, "type", "application/json"))),
                "data": get_assignment(body_table, "data"),
            }

        postprocess_table = get_table(prefix + ["postprocess"])
        if postprocess_table:
            func["postprocess"] = {
                "render_html": bool(get_plain_value(get_assignment(postprocess_table, "render_html", False))),
                "evaluate": get_plain_value(get_assignment(postprocess_table, "evaluate", "")),
                "goto_pipeline": get_assignment(postprocess_table, "goto_pipeline"),
            }

    return {
        "source_path": str(msra_path.resolve()),
        "app": app,
        "prefixes": prefixes,
        "regexes": regexes,
        "groups": groups,
        "variables": variables,
        "headers": headers_spec,
        "warmup": warmup_spec,
        "functions": functions,
    }


def build_input_spec(table: dict[str, Any], get_assignment) -> dict[str, Any]:
    return {
        "name": table["path"][-1],
        "type": get_assignment(table, "type"),
        "default": get_assignment(table, "default"),
        "required": bool(get_plain_value(get_assignment(table, "required", False))),
        "values": get_assignment(table, "values"),
        "revalue": get_assignment(table, "revalue"),
        "read_only": bool(get_plain_value(get_assignment(table, "read_only", False))),
        "from": get_assignment(table, "from"),
        "description": str(get_plain_value(get_assignment(table, "description", ""))),
    }


def build_url_param_spec(table: dict[str, Any], get_assignment) -> dict[str, Any]:
    return {
        "name": table["path"][-1],
        "sub_url": bool(get_plain_value(get_assignment(table, "sub_url", False))),
        "required": bool(get_plain_value(get_assignment(table, "required", False))),
        "list": bool(get_plain_value(get_assignment(table, "list", False))),
        "data": get_assignment(table, "data"),
        "values": get_assignment(table, "values"),
        "description": str(get_plain_value(get_assignment(table, "description", ""))),
    }


def generate_project(
    project: dict[str, Any],
    output_dir: Path,
    package_name: str | None = None,
    source_root: Path | None = None,
) -> None:
    output_dir = output_dir.resolve()
    source_root = source_root.resolve() if source_root is not None else Path(project["source_path"]).resolve().parent
    package_name = package_name or infer_package_name(project["app"]["name"])

    package_root = output_dir / package_name
    endpoints_root = package_root / "endpoints"
    postprocess_root = package_root / "postprocess"
    package_root.mkdir(parents=True, exist_ok=True)
    endpoints_root.mkdir(parents=True, exist_ok=True)
    postprocess_root.mkdir(parents=True, exist_ok=True)

    write_text(output_dir / "pyproject.toml", render_pyproject(project, package_name))
    write_text(package_root / "__init__.py", render_init(project, package_name))
    write_text(package_root / "abstraction.py", render_abstraction(project))
    write_text(package_root / "manager.py", render_manager(project, package_name))
    write_text(endpoints_root / "catalog.py", render_catalog_module(project, package_name))
    write_text(endpoints_root / "geolocation.py", render_geolocation_module(project, package_name))
    write_text(endpoints_root / "advertising.py", render_advertising_module(project, package_name))
    write_text(endpoints_root / "general.py", render_general_module(project, package_name))

    for script in collect_postprocess_scripts(project):
        source = source_root / script
        target = package_root / script
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)


def render_pyproject(project: dict[str, Any], package_name: str) -> str:
    version = project["app"]["version"]
    return "\n".join(
        [
            "[build-system]",
            'requires = ["setuptools>=61.0", "wheel"]',
            "build-backend = \"setuptools.build_meta\"",
            "",
            "[project]",
            f'name = "{package_name}"',
            'dynamic = ["version"]',
            'description = "Generated async Python client from MSRA"',
            'readme = "README.md"',
            'requires-python = ">=3.10"',
            'license = "MIT"',
            'authors = [',
            '    { name = "Miskler" }',
            "]",
            "",
            "[tool.setuptools]",
            "include-package-data = true",
            "",
            "[tool.setuptools.package-data]",
            f'{package_name} = ["postprocess/*.js"]',
            "",
            'dependencies = [',
            '    "camoufox[geoip]",',
            '    "human_requests",',
            '    "aiohttp",',
            '    "aiohttp-retry"',
            "]",
            "",
            "[tool.setuptools.dynamic]",
            'version = { attr = "%s.__version__" }' % package_name,
            "",
            "[tool.pytest.ini_options]",
            'pythonpath = ["."]',
            'testpaths = ["tests"]',
            'python_files = ["*_test.py", "*_tests.py"]',
            'filterwarnings = [',
            '    "ignore::pytest.PytestUnraisableExceptionWarning",',
            '    "ignore:Event loop is closed:RuntimeWarning",',
            "]",
            'anyio_mode = "auto"',
            f'autotest_start_class = "{package_name}.FixPriceAPI"',
            'addopts = "-v --tb=short --disable-warnings"',
            "",
        ]
    )


def render_init(project: dict[str, Any], package_name: str) -> str:
    lines = [
        f"from .abstraction import {', '.join(abstraction_exports(project))}",
        "from .manager import FixPriceAPI",
        "",
        f'__all__ = ["FixPriceAPI", {", ".join(repr(name) for name in abstraction_exports(project))}]' if abstraction_exports(project) else '__all__ = ["FixPriceAPI"]',
        f'__version__ = "{project["app"]["version"]}"',
        "",
    ]
    return "\n".join(lines)


def abstraction_exports(project: dict[str, Any]) -> list[str]:
    exports = []
    if any(is_catalog_sort_function(func) for func in project["functions"]):
        exports.append("CatalogSort")
    return exports


def render_abstraction(project: dict[str, Any]) -> str:
    lines = ["\"\"\"Shared generated constants and enums.\"\"\"", ""]
    for regex in project["regexes"]:
        lines.append(f'{regex["name"]} = r"{escape_regex_literal(str(regex["regex"]))}"')
        if regex["raise"]:
            lines.append(f'# {regex["raise"]}')
        lines.append("")

    if any(is_catalog_sort_function(func) for func in project["functions"]):
        lines.extend(
            [
                "class CatalogSort:",
                '    """Sort order helper generated from MSRA values."""',
                "",
                '    POPULARITY = "sold"',
                '    """Most popular first."""',
                "",
                '    ALPHABET = "abc"',
                "",
                "    class Price:",
                '        """Sort by price."""',
                "",
                '        ASC = "min"',
                '        """Cheapest first."""',
                "",
                '        DESC = "max"',
                '        """Most expensive first."""',
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def render_manager(project: dict[str, Any], package_name: str) -> str:
    app = project["app"]
    prefixes = project["prefixes"]
    headers = project["headers"] or {}
    warmup = project["warmup"] or {}
    functions = project["functions"]
    lines: list[str] = [
        '"""Async FixPrice client generated from MSRA."""',
        "",
        "from collections import defaultdict",
        "from dataclasses import dataclass, field",
        "from typing import Any, Literal",
        "",
        "from camoufox import AsyncCamoufox, DefaultAddons",
        "from human_requests import (ApiParent, HumanBrowser, HumanContext, HumanPage,",
        "                            api_child_field)",
        "from human_requests.abstraction import FetchResponse, HttpMethod, Proxy",
        "from human_requests.network_analyzer.anomaly_sniffer import (",
        "    HeaderAnomalySniffer, WaitHeader, WaitSource)",
        "import re",
        "",
        "from . import abstraction",
        f"from .abstraction import {', '.join(abstraction_exports(project))}" if abstraction_exports(project) else "",
        "from .endpoints.advertising import ClassAdvertising",
        "from .endpoints.catalog import ClassCatalog",
        "from .endpoints.general import ClassGeneral",
        "from .endpoints.geolocation import ClassGeolocation",
        "",
        "",
        "@dataclass",
        "class FixPriceAPI(ApiParent):",
        '    """Generated async client for FixPrice."""',
        "",
    ]
    if app.get("timeout_ms") is not None:
        lines.extend(
            [
                f"    timeout_ms: float = {float(app['timeout_ms']):.1f}",
                '    """Timeout in milliseconds."""',
                "    headless: bool = True",
                '    """Run browser in headless mode."""',
                "    test_mode: bool = False",
                '    """Enable warmup steps used by tests."""',
                "    proxy: str | dict | Proxy | None = field(default_factory=Proxy.from_env)",
                '    """Proxy configuration for browser and direct requests."""',
                "    browser_opts: dict[str, Any] = field(default_factory=dict)",
                '    """Additional options passed to Camoufox."""',
                "",
            ]
        )
    for prefix_name, prefix_value in prefixes.items():
        lines.append(f'    {prefix_name}: str = {render_simple_value(prefix_value)}')
    if prefixes:
        lines.append("")
    lines.extend(
        [
            "    # Created in _warmup",
            "    session: HumanBrowser = field(init=False, repr=False)",
            '    """Browser session used for requests."""',
            "    ctx: HumanContext = field(init=False, repr=False)",
            '    """Browser context."""',
            "    page: HumanPage = field(init=False, repr=False)",
            '    """Browser page."""',
            "",
            "    unstandard_headers: dict[str, str] = field(init=False, repr=False)",
            '    """Collected custom headers."""',
            "    unstandard_urls: dict[str, list[str]] = field(init=False, repr=False)",
            '    """Collected request urls grouped by header/anomaly name."""',
            "",
            "    Geolocation: ClassGeolocation = api_child_field(ClassGeolocation)",
            '    """API for geolocation and store lookup."""',
            "    Catalog: ClassCatalog = api_child_field(ClassCatalog)",
            '    """API for catalog and products."""',
            "    Advertising: ClassAdvertising = api_child_field(ClassAdvertising)",
            '    """API for advertising content."""',
            "    General: ClassGeneral = api_child_field(ClassGeneral)",
            '    """API for general helpers."""',
            "",
            "    async def __aenter__(self):",
            "        await self._warmup()",
            "        return self",
            "",
            "    async def _warmup(self) -> None:",
            '        """Warm up the browser session and capture anti-bot headers."""',
            "        px = self.proxy if isinstance(self.proxy, Proxy) else Proxy(self.proxy)",
            "        br = await AsyncCamoufox(",
            f"            headless=self.headless,",
            "            proxy=px.as_dict(),",
            f"            humanize={str(bool(warmup.get('humanize', True)))},",
            "            **self.browser_opts,",
            f"            block_images={str(bool(warmup.get('block_images', True)))},",
            "            i_know_what_im_doing=True,",
            "            exclude_addons=[DefaultAddons.UBO],",
            "        ).start()",
            "",
            "        self.session = HumanBrowser.replace(br)",
            "        self.ctx = await self.session.new_context()",
            "        self.page = await self.ctx.new_page()",
            f'        self.page.on_error_screenshot_path = {render_simple_value(warmup.get("on_error_screenshot_path", "screenshot.png"))}',
            "",
        ]
    )

    if warmup.get("headers_sniffer"):
        lines.extend(
            [
                "        sniffer = HeaderAnomalySniffer(",
                "            include_subresources=True,",
                "            url_filter=lambda u: u.startswith(self.CATALOG_URL),",
                "        )",
                "        await sniffer.start(self.ctx)",
                "",
            ]
        )
    else:
        lines.extend(
            [
                "        sniffer = None",
                "",
            ]
        )

    lines.extend(_render_warmup_flow(project, warmup))

    lines.extend(
        [
            "",
            "    async def __aexit__(self, *exc):",
            "        await self.close()",
            "",
            "    async def close(self):",
            "        await self.session.close()",
            "",
        ]
    )

    for variable in project["variables"]:
        lines.extend(render_variable_property(variable))
        lines.append("")

    lines.extend(
        [
            "    async def _request(",
            "        self,",
            "        method: HttpMethod,",
            "        url: str,",
            "        *,",
            "        real_route: str | None = None,",
            "        json_body: Any | None = None,",
            "        add_unstandard_headers: bool = True,",
            "        credentials: bool = True,",
            "    ) -> FetchResponse:",
            '        """Perform an HTTP request through the human browser session."""',
            "        if real_route:",
            "            self.client_route = real_route",
            "",
            "        async def f() -> FetchResponse:",
            "            return await self.page.fetch(",
            "                url=url,",
            "                method=method,",
            "                body=json_body,",
            f'                mode={render_simple_value(headers.get("cors_mode", "cors"))},',
            '                credentials="include" if credentials else "omit",',
            "                timeout_ms=self.timeout_ms,",
            f"                referrer={render_ref_value(headers.get('referrer'), self_ref='self') if headers.get('referrer') is not None else 'self.MAIN_SITE_ORIGIN'},",
            f"                headers={render_request_headers(headers)},",
            "            )",
            "",
            "        resp = await f()",
            '        if "html" in resp.headers.get("content-type", ""):',
            '            temporal_page = await resp.render(wait_until="networkidle")',
            "            await temporal_page.wait_for_selector(",
            '                selector="body > pre", timeout=self.timeout_ms, state="visible"',
            "            )",
            "            await temporal_page.close()",
            "            resp = await f()",
            "",
            "        return resp",
            "",
        ]
    )

    return "\n".join(lines)


def render_variable_property(variable: dict[str, Any]) -> list[str]:
    name = variable["name"]
    header = variable_header_name(variable)
    type_names = variable_type_names(variable)
    getter_return = type_annotation_from_types(type_names)
    if "| None" not in getter_return:
        getter_return = f"{getter_return} | None"
    lines = [
        "    @property",
        f"    def {name}(self) -> {getter_return}:",
        f"        \"\"\"{escape_docstring(variable['description'] or name)}\"\"\"",
        f"        raw = self.unstandard_headers.get({render_simple_value(header)}, None)",
    ]
    if "integer" in type_names:
        lines.extend(
            [
                "        if raw is None:",
                "            return None",
                "        return int(raw)",
            ]
        )
    else:
        lines.append("        return raw")

    if should_render_setter(variable):
        lines.extend(
            [
                "",
                f"    @{name}.setter",
                f"    def {name}(self, value) -> None:",
            ]
        )
        lines.extend(render_variable_setter(variable, header))
    return lines


def render_variable_setter(variable: dict[str, Any], header: str) -> list[str]:
    name = variable["name"]
    type_names = variable_type_names(variable)
    revalue = variable.get("revalue")
    lines: list[str] = []
    if "null" in type_names:
        lines.extend(
            [
                "        if value is None:",
                f"            self.unstandard_headers.pop({render_simple_value(header)}, None)",
                "            return",
                "",
            ]
        )
    if "integer" in type_names:
        lines.extend(
            [
                "        if not isinstance(value, int) or isinstance(value, bool):",
                f'            raise TypeError("`{name}` must be int")',
            ]
        )
    elif "boolean" in type_names:
        lines.extend(
            [
                "        if not isinstance(value, bool):",
                f'            raise TypeError("`{name}` must be bool")',
            ]
        )
    else:
        lines.extend(
            [
                "        if not isinstance(value, str):",
                f'            raise TypeError("`{name}` must be str")',
            ]
        )
    if revalue is not None:
        pattern = revalue_to_pattern(revalue)
        if pattern:
            lines.extend(
                [
                    f"        if re.fullmatch({render_simple_value(pattern)}, str(value)) is None:",
                    f'            raise ValueError("`{name}` does not match the expected format")',
                ]
            )
        else:
            numeric_range = revalue_to_range(revalue)
            if numeric_range:
                lo, hi = numeric_range
                lines.extend(
                    [
                        f"        if int(value) < {lo} or int(value) > {hi}:",
                        f'            raise ValueError("`{name}` must be between {lo} and {hi}")',
                    ]
                )

    lines.extend(
        [
            f"        self.unstandard_headers.update({{{render_simple_value(header)}: str(value)}})",
        ]
    )
    return lines


def should_render_setter(variable: dict[str, Any]) -> bool:
    if variable["name"] == "token":
        return False
    return not bool(variable.get("read_only", False))


def render_catalog_module(project: dict[str, Any], package_name: str) -> str:
    catalog_group = find_group(project, ["Catalog"])
    lines = [
        '"""Catalog-related generated endpoints."""',
        "",
        "from __future__ import annotations",
        "",
        "import json",
        "from dataclasses import dataclass",
        "from types import MethodType",
        "from pathlib import Path",
        "from typing import TYPE_CHECKING, Optional, overload",
        "",
        "from human_requests import ApiChild, ApiParent, api_child_field, autotest",
        "from human_requests.abstraction import FetchResponse, HttpMethod",
        "from playwright.async_api import Response as PWResponse",
        "",
        "from .. import abstraction",
        "",
        "if TYPE_CHECKING:",
        f"    from {package_name}.manager import FixPriceAPI",
        "",
        "",
        "@dataclass(init=False)",
        f'class ClassCatalog(ApiChild["FixPriceAPI"], ApiParent):',
        '    """Methods for catalog tree and product listing."""',
        "",
        "    Product: ProductService = api_child_field(",
        "        lambda parent: ProductService(parent.parent)",
        "    )",
        '    """Service for catalog products."""',
        "",
        "    def __init__(self, parent: \"FixPriceAPI\"):",
        "        super().__init__(parent)",
        "        ApiParent.__post_init__(self)",
        "",
        "    @autotest",
        "    async def tree(self) -> FetchResponse:",
        '        """Return catalog tree."""',
        "        return await self._parent._request(",
        "            HttpMethod.GET, f\"{self._parent.CATALOG_URL}/v1/category\"",
        "        )",
        "",
        "    @autotest",
        "    async def products_list(",
        "        self,",
        "        category_alias: str,",
        "        subcategory_alias: Optional[str] = None,",
        "        page: int = 1,",
        "        limit: int = 24,",
        "        sort: abstraction.CatalogSort | str = abstraction.CatalogSort.POPULARITY,",
        "    ) -> FetchResponse:",
        '        """Return products inside a category or subcategory."""',
        "        if page < 1:",
        "            raise ValueError(\"`page` must be greater than 0\")",
        "        elif limit > 27 or limit < 1:",
        "            raise ValueError(\"`limit` must be in range 1-27\")",
        "",
        "        url = f\"{self._parent.CATALOG_URL}/v1/product/in/{category_alias}\"",
        "        real_route = f\"/catalog/{category_alias}\"",
        "        if subcategory_alias:",
        "            url += f\"/{subcategory_alias}\"",
        "            real_route += f\"/{subcategory_alias}\"",
        "        url += f\"?page={page}&limit={limit}&sort={sort}\"",
        "",
        "        json_body = {",
        '            "category": category_alias,',
        '            "brand": [],',
        '            "price": [],',
        '            "isDividedPrice": False,',
        '            "isNew": False,',
        '            "isHit": False,',
        '            "isSpecialPrice": False,',
        "        }",
        "        if subcategory_alias:",
        '            json_body["category"] += f"/{subcategory_alias}"',
        "",
        "        return await self._parent._request(",
        "            HttpMethod.POST, url=url, real_route=real_route, json_body=json_body",
        "        )",
        "",
        "",
        "class ProductService(ApiChild[\"FixPriceAPI\"]):",
        '    """Product-level catalog operations."""',
        "",
        "    @autotest",
        "    async def balance(",
        "        self, product_id: int, in_stock: bool = True, search: Optional[str] = None",
        "    ) -> FetchResponse:",
        '        """Check product balance in the current city."""',
        "        if self._parent.city_id is None:",
        '            raise ValueError("City ID is not set")',
        "",
        "        url = f\"{self._parent.CATALOG_URL}/v1/store/balance/{product_id}?canPickup=all\"",
        "        if search:",
        "            url += f\"&addressPart={search}\"",
        "        if in_stock:",
        "            url += \"&inStock=true\"",
        "",
        "        return await self._parent._request(HttpMethod.GET, url)",
        "",
        "    @overload",
        "    async def info(self, *, url: str): ...",
        "",
        "    @overload",
        "    async def info(self, *, category: str, product_id: int, slug: str): ...",
        "",
        "    @autotest",
        "    async def info(",
        "        self,",
        "        *,",
        "        url: str | None = None,",
        "        category: str | None = None,",
        "        product_id: int | None = None,",
        "        slug: str | None = None,",
        "    ) -> PWResponse:",
        '        """Load product page HTML and replace resp.json with parsed product data."""',
        "        real_url = \"https://fix-price.com/catalog/\"",
        "        if url is None:",
        "            if category is None or product_id is None or slug is None:",
        '                raise TypeError("Either url or (category, product_id, slug) must be provided")',
        "",
        "            real_url += f\"{category}/p-{product_id}-{slug}\"",
        "        else:",
        "            real_url += url",
        "",
        "        page = await self._parent.ctx.new_page()",
        "        try:",
        "            resp = await page.goto(real_url, wait_until=\"domcontentloaded\")",
        "            if resp is None:",
        '                raise RuntimeError("page.goto() returned None")',
        "",
        "            evaluate_script = (",
        "                Path(__file__).resolve().parent",
        "                / \"postprocess\"",
        "                / \"catalog-product-info.evaluate.js\"",
        "            ).read_text(encoding=\"utf-8\")",
        "            evaluate_result = await page.evaluate(evaluate_script)",
        "            raw_json = (",
        "                evaluate_result.get(\"data\")",
        "                if isinstance(evaluate_result, dict)",
        "                else evaluate_result",
        "            )",
        "",
        "            nuxt_data = (",
        "                json.loads(raw_json)[\"useState\"][\"uniquePseudoAsyncDataStateKey\"][",
        '                    "product"',
        "                ]",
        "                if raw_json",
        "                else None",
        "            )",
        "",
        "            def _json(self):",
        "                return nuxt_data",
        "",
        "            resp.json = MethodType(_json, resp)",
        "",
        "            return resp",
        "        finally:",
        "            await page.close()",
        "",
    ]
    return "\n".join(lines)


def render_geolocation_module(project: dict[str, Any], package_name: str) -> str:
    lines = [
        '"""Geolocation endpoints."""',
        "",
        "from __future__ import annotations",
        "",
        "from dataclasses import dataclass",
        "from typing import TYPE_CHECKING",
        "",
        "from human_requests import ApiChild, ApiParent, api_child_field, autotest",
        "from human_requests.abstraction import FetchResponse, HttpMethod",
        "",
        "if TYPE_CHECKING:",
        f"    from {package_name}.manager import FixPriceAPI",
        "",
        "",
        "@dataclass(init=False)",
        f'class ClassGeolocation(ApiChild["FixPriceAPI"], ApiParent):',
        '    """Geolocation and store lookup methods."""',
        "",
        "    Shop: ShopService = api_child_field(lambda parent: ShopService(parent.parent))",
        '    """Store lookup service."""',
        "",
        "    def __init__(self, parent: \"FixPriceAPI\"):",
        "        super().__init__(parent)",
        "        ApiParent.__post_init__(self)",
        "",
        "    @autotest",
        "    async def countries_list(self, alias: str = None) -> FetchResponse:",
        '        """Return all countries and optional ISO-2 alias filter."""',
        "        url = f\"{self._parent.CATALOG_URL}/v1/location/country\"",
        "        if alias:",
        "            if len(alias) != 2:",
        '                raise ValueError("`alias` must be ISO-2. Length must be 2")',
        "",
        "            url += f\"?alias={alias.upper()}\"",
        "",
        "        return await self._parent._request(HttpMethod.GET, url=url)",
        "",
        "    @autotest",
        "    async def regions_list(self, country_id: int = None) -> FetchResponse:",
        '        """Return all regions."""',
        "        url = f\"{self._parent.CATALOG_URL}/v1/location/region\"",
        "        if country_id:",
        "            url += f\"?countryId={country_id}\"",
        "",
        "        return await self._parent._request(HttpMethod.GET, url=url)",
        "",
        "    @autotest",
        "    async def cities_list(self, country_id: int) -> FetchResponse:",
        '        """Return city list."""',
        "        url = f\"{self._parent.CATALOG_URL}/v1/location/city\"",
        "        if country_id:",
        "            url += f\"?countryId={country_id}\"",
        "",
        "        return await self._parent._request(HttpMethod.GET, url=url)",
        "",
        "    @autotest",
        "    async def city_info(self, city_id: int) -> FetchResponse:",
        '        """Return single city info."""',
        "        return await self._parent._request(",
        "            HttpMethod.GET, f\"{self._parent.CATALOG_URL}/v1/location/city/{city_id}\"",
        "        )",
        "",
        "",
        "class ShopService(ApiChild[\"FixPriceAPI\"]):",
        '    """Store search service."""',
        "",
        "    @autotest",
        "    async def search(",
        "        self,",
        "        country_id: int = None,",
        "        region_id: int = None,",
        "        city_id: int = None,",
        "        search: str = None,",
        "    ) -> FetchResponse:",
        '        """Search stores by country, region, city, or address."""',
        "        url = f\"{self._parent.CATALOG_URL}/v1/store?searchType=metro&canPickup=all&showTemporarilyClosed=all\"",
        "",
        "        if country_id:",
        "            url += f\"&countryId={country_id}\"",
        "        if region_id:",
        "            url += f\"&regionId={region_id}\"",
        "        if city_id:",
        "            url += f\"&cityId={city_id}\"",
        "        if search:",
        "            url += f\"&addressPart={search}\"",
        "",
        "        return await self._parent._request(HttpMethod.GET, url=url)",
        "",
    ]
    return "\n".join(lines)


def render_advertising_module(project: dict[str, Any], package_name: str) -> str:
    return "\n".join(
        [
            '"""Advertising endpoints."""',
            "",
            "from typing import TYPE_CHECKING",
            "",
            "from human_requests import ApiChild, autotest",
            "from human_requests.abstraction import FetchResponse, HttpMethod",
            "",
            "if TYPE_CHECKING:",
            f"    from {package_name}.manager import FixPriceAPI",
            "",
            "",
            "class ClassAdvertising(ApiChild[\"FixPriceAPI\"]):",
            '    """Advertising-related endpoints."""',
            "",
            "    @autotest",
            "    async def home_brands_list(self) -> FetchResponse:",
            '        """Return homepage brand list."""',
            "        return await self._parent._request(",
            "            HttpMethod.GET, f\"{self._parent.CATALOG_URL}/v1/home/brand\"",
            "        )",
            "",
        ]
    )


def render_general_module(project: dict[str, Any], package_name: str) -> str:
    return "\n".join(
        [
            '"""General helpers."""',
            "",
            "from io import BytesIO",
            "from typing import TYPE_CHECKING",
            "",
            "from aiohttp_retry import ExponentialRetry, RetryClient",
            "from human_requests import ApiChild",
            "from human_requests.abstraction import Proxy",
            "",
            "if TYPE_CHECKING:",
            f"    from {package_name}.manager import FixPriceAPI",
            "",
            "",
            "class ClassGeneral(ApiChild[\"FixPriceAPI\"]):",
            '    """General helper methods."""',
            "",
            "    async def download_image(",
            "        self, url: str, retry_attempts: int = 3, timeout: float = 10",
            "    ) -> BytesIO:",
            '        """Download an image using direct HTTP retries."""',
            "        retry_options = ExponentialRetry(",
            "            attempts=retry_attempts, start_timeout=3.0, max_timeout=timeout",
            "        )",
            "",
            "        px = (",
            "            self._parent.proxy",
            "            if isinstance(self._parent.proxy, Proxy)",
            "            else Proxy(self._parent.proxy)",
            "        )",
            "        async with RetryClient(retry_options=retry_options) as retry_client:",
            "            async with retry_client.get(",
            "                url, raise_for_status=True, proxy=px.as_str()",
            "            ) as resp:",
            "                body = await resp.read()",
            "                file = BytesIO(body)",
            '                file.name = url.split("/")[-1]',
            "        return file",
            "",
        ]
    )


def _render_warmup_flow(project: dict[str, Any], warmup: dict[str, Any]) -> list[str]:
    pipeline = warmup.get("pipeline")
    steps = inline_array_to_list(pipeline)
    wait_sniffer_step = next((step for step in steps if step.get("action") == "wait_sniffer"), None)
    wait_network_idle = next((step for step in steps if step.get("action") == "wait_network" and step.get("state") == "idle"), None)
    wait_network_load = next((step for step in steps if step.get("action") == "wait_network" and step.get("state") == "load"), None)
    test_steps = [step for step in steps if step.get("for_tests")]
    final_wait_step = next((step for step in steps if step.get("action") == "wait_element" and step.get("what") == "body > pre"), None)
    main_click_step = next((step for step in test_steps if step.get("what") == "div.selected-city > div.buttons > button.button.normal"), None)
    category_click_step = next((step for step in test_steps if step.get("what") == "a.link.product-category"), None)
    page_content_step = next((step for step in test_steps if step.get("what") == "div.page-content"), None)

    lines: list[str] = []
    lines.extend(
        [
            f"        await self.page.goto(self.MAIN_SITE_URL, wait_until={render_simple_value('networkidle' if wait_network_idle else 'networkidle')})",
        ]
    )
    if wait_sniffer_step:
        header_names = header_names_from_wait_sniffer(wait_sniffer_step)
        lines.extend(
            [
                "",
                "        await sniffer.wait(",
                "            tasks=[",
                "                WaitHeader(",
                "                    source=WaitSource.REQUEST,",
                f"                    headers={render_simple_value(header_names)},",
                "                )",
                "            ],",
                "            timeout_ms=self.timeout_ms,",
                "        )",
            ]
        )
    if test_steps:
        lines.extend(["", "        if self.test_mode:"])
        if main_click_step:
            lines.extend(
                [
                    "            btn = self.page.locator(",
                    f"                {render_simple_value(main_click_step['what'])}",
                    "            ).first",
                    "            await btn.wait_for(state=\"visible\", timeout=self.timeout_ms)",
                    "            await btn.click(timeout=self.timeout_ms)",
                    "",
                ]
            )
        if category_click_step:
            lines.extend(
                [
                    f"            await self.page.locator({render_simple_value(category_click_step['what'])}).first.click()",
                ]
            )
        if page_content_step:
            lines.extend(
                [
                    "            await self.page.wait_for_selector(",
                    f"                selector={render_simple_value(page_content_step['what'])}, timeout=self.timeout_ms, state=\"visible\"",
                    "            )",
                ]
            )
        if wait_network_load:
            lines.extend(
                [
                    "            await self.page.wait_for_load_state(",
                    f"                {render_simple_value(wait_network_load.get('state', 'load'))}",
                    "            )",
                ]
            )

    lines.extend(
        [
            "",
            "        await self.page.goto(",
            "            self.CATALOG_URL, wait_until=\"networkidle\"",
            "        )  # acceleration: skip OPTION pre-fetch",
        ]
    )
    if final_wait_step:
        lines.extend(
            [
                "        await self.page.wait_for_selector(",
                f"            selector={render_simple_value(final_wait_step['what'])}, timeout=self.timeout_ms, state=\"visible\"",
                "        )",
            ]
        )
    lines.extend(
        [
            "",
            "        result_sniffer = await sniffer.complete()",
            "",
            "        result = defaultdict(set)",
            "",
            "        for _url, headers in result_sniffer[\"request\"].items():",
            "            for header, values in headers.items():",
            "                result[header].update(values)",
            "",
            "        self.unstandard_headers = {k: list(v)[0] for k, v in result.items()}",
            "        self.unstandard_urls = result_sniffer[\"request\"]",
            "",
        ]
    )
    return lines


def render_ref_value(expr: dict[str, Any] | None, self_ref: str = "self._parent") -> str:
    if expr is None:
        return "None"
    if expr.get("kind") == "ref":
        parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
        if not parts:
            return "None"
        root = parts[0]
        if root == "DOCUMENT" and len(parts) >= 3 and parts[1] == "PREFIXES":
            return f"{self_ref}.{parts[2]}"
        if root == "DOCUMENT" and len(parts) >= 3 and parts[1] == "REGEXES":
            return f"abstraction.{parts[2]}"
        if root == "VARIABLES" and len(parts) >= 2:
            return f"{self_ref}.{parts[1]}"
        if root == "INPUT" and len(parts) >= 2:
            return parts[1]
        if root == "UNSTANDART_HEADERS":
            if len(parts) == 1:
                return f"{self_ref}.unstandard_headers"
            if len(parts) >= 3 and parts[1] == "REQUEST":
                return f"{self_ref}.unstandard_headers.get({render_simple_value(parts[2])})"
            return f"{self_ref}.unstandard_headers"
    return render_expr(expr, self_ref=self_ref)


def render_expr(expr: dict[str, Any] | None, self_ref: str = "self._parent") -> str:
    if expr is None:
        return "None"
    kind = expr.get("kind")
    if kind == "string":
        return render_simple_value(expr.get("value"))
    if kind == "number":
        return repr(expr.get("value"))
    if kind == "bool":
        return "True" if expr.get("value") else "False"
    if kind == "null":
        return "None"
    if kind == "ref":
        return render_ref_value(expr, self_ref=self_ref)
    if kind == "array":
        return "[" + ", ".join(render_expr(item, self_ref=self_ref) for item in expr.get("items", [])) + "]"
    if kind == "inline_table":
        return "{" + ", ".join(
            f"{render_simple_value(item['key'])}: {render_expr(item['value'], self_ref=self_ref)}"
            for item in expr.get("items", [])
        ) + "}"
    if kind == "sequence":
        return " + ".join(render_expr(item, self_ref=self_ref) for item in expr.get("items", []))
    if kind == "merge":
        parts = expr.get("parts", [])
        inline = next((part for part in parts if part.get("kind") == "inline_table"), None)
        if inline is not None:
            other_parts = [part for part in parts if part is not inline]
            rendered = [render_expr(inline, self_ref=self_ref)] + [render_expr(part, self_ref=self_ref) for part in other_parts]
            return " | ".join(rendered)
        return " + ".join(render_expr(item, self_ref=self_ref) for item in parts)
    if kind == "call":
        callee = render_expr(expr.get("callee"), self_ref=self_ref)
        args = ", ".join(f"{arg['name']}={render_expr(arg['value'], self_ref=self_ref)}" for arg in expr.get("args", []))
        return f"{callee}({args})"
    if kind == "index":
        return f"{render_expr(expr.get('value'), self_ref=self_ref)}[{render_expr(expr.get('index'), self_ref=self_ref)}]"
    return "None"


def get_plain_value(expr: dict[str, Any] | None) -> Any:
    if expr is None:
        return None
    if not isinstance(expr, dict):
        return expr
    kind = expr.get("kind")
    if kind == "string":
        return expr.get("value")
    if kind == "number":
        return expr.get("value")
    if kind == "bool":
        return expr.get("value")
    if kind == "null":
        return None
    if kind == "ref":
        return expr
    if kind == "array":
        return [get_plain_value(item) for item in expr.get("items", [])]
    if kind == "inline_table":
        return {item["key"]: get_plain_value(item["value"]) for item in expr.get("items", [])}
    if kind == "sequence":
        return "".join(str(get_plain_value(item)) for item in expr.get("items", []))
    if kind == "merge":
        return "".join(str(get_plain_value(item)) for item in expr.get("parts", []))
    return expr


def variable_header_name(variable: dict[str, Any]) -> str:
    from_expr = variable.get("from")
    if from_expr and from_expr.get("kind") == "ref":
        parts = [part["value"] for part in from_expr.get("parts", []) if part.get("kind") == "name"]
        if len(parts) >= 3 and parts[0] == "UNSTANDART_HEADERS" and parts[1] == "REQUEST":
            return str(parts[2])
    return variable["name"]


def variable_type_names(variable: dict[str, Any]) -> set[str]:
    types = variable.get("types")
    if isinstance(types, dict):
        kind = types.get("kind")
        if kind == "array":
            result = set()
            for item in types.get("items", []):
                if isinstance(item, dict) and item.get("kind") == "inline_table":
                    item_dict = inline_table_to_dict(item)
                    type_name = item_dict.get("type")
                    if type_name:
                        result.add(str(type_name))
            return result
        if kind == "inline_table":
            item_dict = inline_table_to_dict(types)
            type_name = item_dict.get("type")
            return {str(type_name)} if type_name else set()
        type_name = types.get("type")
        return {str(type_name)} if type_name else set()
    if isinstance(types, list):
        result = set()
        for item in types:
            if isinstance(item, dict):
                type_name = item.get("type")
                if type_name:
                    result.add(str(type_name))
        return result
    if isinstance(types, str):
        return {types}
    return set()


def extract_variable_revalue(types_expr: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(types_expr, dict) or types_expr.get("kind") != "array":
        return None
    for item in types_expr.get("items", []):
        if not isinstance(item, dict) or item.get("kind") != "inline_table":
            continue
        for inline_item in item.get("items", []):
            if inline_item.get("key") == "revalue":
                return inline_item.get("value")
    return None


def type_annotation_from_types(type_names: set[str]) -> str:
    if not type_names:
        return "Any"
    non_null = {name for name in type_names if name != "null"}
    base = {
        "string": "str",
        "integer": "int",
        "boolean": "bool",
        "number": "float",
        "array": "list[Any]",
        "object": "dict[str, Any]",
    }
    if not non_null:
        return "Any | None"
    annotation = base.get(next(iter(non_null)), "Any")
    if "null" in type_names:
        return f"{annotation} | None"
    return annotation


def inline_array_to_list(expr: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not expr or expr.get("kind") != "array":
        return []
    result: list[dict[str, Any]] = []
    for item in expr.get("items", []):
        if item and item.get("kind") == "inline_table":
            result.append(inline_table_to_dict(item))
    return result


def inline_table_to_dict(expr: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"kind": expr.get("kind")}
    for item in expr.get("items", []):
        result[item["key"]] = get_plain_value(item["value"])
    return result


def render_simple_value(value: Any) -> str:
    if isinstance(value, str):
        return repr(value)
    if value is None:
        return "None"
    return repr(value)


def escape_docstring(text: str) -> str:
    return text.replace('"""', '\\"\\"\\"')


def escape_regex_literal(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')


def render_request_headers(headers_spec: dict[str, Any] | None) -> str:
    base = '{"Accept": "application/json, text/plain, */*"}'
    if not headers_spec:
        return f"{base} | (self.unstandard_headers if add_unstandard_headers else {{}})"
    headers_expr = headers_spec.get("headers")
    if headers_expr and headers_expr.get("kind") == "merge":
        inline = next((part for part in headers_expr.get("parts", []) if part.get("kind") == "inline_table"), None)
        if inline is not None:
            return f"{render_expr(inline, self_ref='self')} | (self.unstandard_headers if add_unstandard_headers else {{}})"
    if headers_expr and headers_expr.get("kind") == "inline_table":
        return f"{render_expr(headers_expr, self_ref='self')} | (self.unstandard_headers if add_unstandard_headers else {{}})"
    return f"{base} | (self.unstandard_headers if add_unstandard_headers else {{}})"


def render_variable_getter_return(variable: dict[str, Any]) -> str:
    return type_annotation_from_types(variable_type_names(variable))


def variable_revalue_pattern(variable: dict[str, Any]) -> str | None:
    revalue = variable.get("revalue")
    return revalue_to_pattern(revalue)


def revalue_to_pattern(expr: dict[str, Any] | None) -> str | None:
    if not expr:
        return None
    if expr.get("kind") == "string":
        return str(expr.get("value"))
    if expr.get("kind") == "ref":
        parts = [part["value"] for part in expr.get("parts", []) if part.get("kind") == "name"]
        if len(parts) >= 3 and parts[0] == "DOCUMENT" and parts[1] == "REGEXES":
            return f"abstraction.{parts[2]}"
    return None


def revalue_to_range(expr: dict[str, Any] | None) -> tuple[int, int] | None:
    if not expr or expr.get("kind") != "inline_table":
        return None
    values = inline_table_to_dict(expr)
    if "from" in values and "to" in values:
        try:
            return int(values["from"]), int(values["to"])
        except (TypeError, ValueError):
            return None
    return None


def is_catalog_sort_function(func: dict[str, Any]) -> bool:
    if func["name"] != "products_list":
        return False
    sort_input = next((item for item in func.get("inputs", []) if item["name"] == "sort"), None)
    if sort_input is None:
        return False
    values = get_plain_value(sort_input.get("values"))
    return values == ["sold", "abc", "min", "max"]


def infer_package_name(app_name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "_", app_name).strip("_").lower()
    if cleaned in {"fixpriceapi", "fix_price_api", "fixprice_api"}:
        return "fixprice_api"
    if "fixprice" in cleaned and not cleaned.endswith("_api"):
        return "fixprice_api"
    return cleaned or "generated_msra_client"


def collect_postprocess_scripts(project: dict[str, Any]) -> list[str]:
    scripts: list[str] = []
    for func in project["functions"]:
        postprocess = func.get("postprocess")
        if not postprocess:
            continue
        evaluate = postprocess.get("evaluate")
        if isinstance(evaluate, str) and evaluate:
            scripts.append(evaluate)
    return scripts


def find_group(project: dict[str, Any], path: list[str]) -> dict[str, Any] | None:
    for group in project.get("groups", []):
        if group.get("path") == path:
            return group
    return None


def header_names_from_wait_sniffer(step: dict[str, Any]) -> list[str]:
    what = step.get("what")
    if what and what.get("kind") == "ref":
        parts = [part["value"] for part in what.get("parts", []) if part.get("kind") == "name"]
        if len(parts) >= 3:
            return [parts[-1]]
    return ["X-Key"]


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
