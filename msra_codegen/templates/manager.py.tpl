"""Async client generated from MSRA."""

from collections import defaultdict
from dataclasses import dataclass, field
from io import BytesIO
import re
from typing import Any

from aiohttp_retry import ExponentialRetry, RetryClient
from camoufox import AsyncCamoufox, DefaultAddons
from human_requests import ApiParent, HumanBrowser, HumanContext, HumanPage, api_child_field
from human_requests.abstraction import FetchResponse, HttpMethod, Proxy
from human_requests.network_analyzer.anomaly_sniffer import (
    HeaderAnomalySniffer, WaitHeader, WaitSource
)

{% from "pipeline_macros.tpl" import render_pipeline_steps %}
from . import abstraction
{% for group in top_groups %}
from .endpoints.{{ group.module_name }} import {{ group.class_name }}
{% endfor %}


@dataclass
class {{ client_class_name }}(ApiParent):
    """Generated async client for {{ app_name_doc }}."""

    timeout_ms: float = {{ app.timeout_ms }}
    """Timeout in milliseconds."""
    headless: bool = True
    """Run browser in headless mode."""
    test_mode: bool = False
    """Enable warmup steps used by tests."""
    proxy: str | dict | Proxy | None = field(default_factory=Proxy.from_env)
    """Proxy configuration for browser and direct requests."""
    browser_opts: dict[str, Any] = field(default_factory=dict)
    """Additional options passed to Camoufox."""

{% for prefix in prefixes %}
    {{ prefix.name }}: str = {{ prefix.value }}
{% endfor %}
{% if prefixes %}

{% endif %}
    # Created in _warmup
    session: HumanBrowser = field(init=False, repr=False)
    """Browser session used for requests."""
    ctx: HumanContext = field(init=False, repr=False)
    """Browser context."""
    page: HumanPage = field(init=False, repr=False)
    """Browser page."""

    unstandard_headers: dict[str, str] = field(init=False, repr=False)
    """Collected custom headers."""
    unstandard_urls: dict[str, list[str]] = field(init=False, repr=False)
    """Collected request urls grouped by header/anomaly name."""

{% for group in top_groups %}
    {{ group.field_name }}: {{ group.class_name }} = api_child_field({{ group.class_name }})
    """API for {{ group.description }}"""
{% endfor %}
{% if top_groups %}

{% endif %}
    async def __aenter__(self):
        await self._warmup()
        return self

    async def _warmup(self) -> None:
        """Warm up the browser session and capture anti-bot headers."""
        px = self.proxy if isinstance(self.proxy, Proxy) else Proxy(self.proxy)
        br = await AsyncCamoufox(
            headless=self.headless,
            proxy=px.as_dict(),
            humanize={{ warmup.humanize }},
            **self.browser_opts,
            block_images={{ warmup.block_images }},
            i_know_what_im_doing=True,
            exclude_addons=[DefaultAddons.UBO],
        ).start()

        self.session = HumanBrowser.replace(br)
        self.ctx = await self.session.new_context()
        self.page = await self.ctx.new_page()
        self.page.on_error_screenshot_path = {{ warmup.on_error_screenshot_path }}

{% if warmup.headers_sniffer %}
        sniffer = HeaderAnomalySniffer(
            include_subresources=True,
            url_filter=lambda u: u.startswith({{ warmup.url_expr }}),
        )
        await sniffer.start(self.ctx)

{% else %}
        sniffer = None

{% endif %}
        await self.page.goto({{ warmup.url_expr }}, wait_until="domcontentloaded")

{% if warmup.pipeline %}
{{ render_pipeline_steps(warmup.pipeline, "        ", "self.page", "sniffer", "self.test_mode") }}
{% endif %}

        result_sniffer = await sniffer.complete() if sniffer else {"request": {}}

        result = defaultdict(set)

        for _url, headers in result_sniffer.get("request", {}).items():
            for header, values in headers.items():
                result[header].update(values)

        self.unstandard_headers = {k: list(v)[0] for k, v in result.items()}
        self.unstandard_urls = result_sniffer.get("request", {})

    async def __aexit__(self, *exc):
        await self.close()

    async def close(self):
        await self.session.close()

{% for variable in variables %}
{{ variable.code }}

{% endfor %}
    async def _request(
        self,
        method: HttpMethod,
        url: str,
        *,
        json_body: Any | None = None,
        add_unstandard_headers: bool = True,
        credentials: bool = True,
    ) -> FetchResponse:
        """Perform an HTTP request through the browser session."""
        return await self.page.fetch(
            url=url,
            method=method,
            body=json_body,
            mode={{ headers.cors_mode }},
            credentials="include" if credentials else "omit",
            timeout_ms=self.timeout_ms,
            referrer={{ headers.referrer }},
            headers={{ headers.headers_expr }},
        )

    async def _direct_request(
        self,
        url: str,
        *,
        retry_attempts: int = 3,
        timeout: float = 10,
    ) -> BytesIO:
        """Download raw bytes with retries, used by direct transport functions."""
        retry_options = ExponentialRetry(
            attempts=retry_attempts, start_timeout=3.0, max_timeout=timeout
        )
        px = self.proxy if isinstance(self.proxy, Proxy) else Proxy(self.proxy)
        async with RetryClient(retry_options=retry_options) as retry_client:
            async with retry_client.get(url, raise_for_status=True, proxy=px.as_str()) as resp:
                body = await resp.read()
                file = BytesIO(body)
                file.name = url.split("/")[-1]
        return file
