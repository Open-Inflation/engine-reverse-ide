"""Async client generated from MSRA."""

from collections import defaultdict
from dataclasses import dataclass
import re
from time import perf_counter, time
from typing import Any

from aiohttp_retry import ExponentialRetry, RetryClient
from camoufox import AsyncCamoufox, DefaultAddons
from human_requests import HumanBrowser, HumanContext, HumanPage
from human_requests.abstraction import HttpMethod, Proxy
from human_requests.network_analyzer.anomaly_sniffer import (
    HeaderAnomalySniffer, WaitHeader, WaitSource
)

from . import abstraction
{% for group in top_groups %}
from .endpoints.{{ group.module_name }} import {{ group.class_name }}
{% endfor %}


@dataclass
class Warmup:
    browser: HumanBrowser
    context: HumanContext
    page: HumanPage
    sniffer: HeaderAnomalySniffer | None
    timeout_ms: int
    test_mode: bool
    prefixes: dict[str, str]


class {{ client_class_name }}:
    """Generated async client for {{ app_name_doc }}."""

    def __init__(
        self,
        timeout_ms: float = {{ app.timeout_ms }},
        headless: bool = True,
        test_mode: bool = False,
        proxy: str | dict | Proxy | None = None,
        browser_opts: dict[str, Any] | None = None,
    ):
        """Generated async client for {{ app_name_doc }}."""
        self.timeout_ms = timeout_ms
        self.headless = headless
        self.test_mode = test_mode
        self.proxy = Proxy.from_env() if proxy is None else proxy
        self.browser_opts = {} if browser_opts is None else dict(browser_opts)
{% for prefix in prefixes %}
        self.{{ prefix.attr_name }} = {{ prefix.value }}
{% endfor %}
        self.session: HumanBrowser | None = None
        self.ctx: HumanContext | None = None
        self.page: HumanPage | None = None
        self.unstandard_headers: dict[str, str] = {}
        self.unstandard_urls: dict[str, list[str]] = {}
{% for variable in variables %}
        self.{{ variable.backing_name }}: {{ variable.getter_return }} = None
{% endfor %}
{% for group in top_groups %}
        self.{{ group.field_name }} = {{ group.class_name }}(self)
{% endfor %}

    async def __aenter__(self):
        await self._warmup()
        return self

    async def _warmup(self) -> None:
        """Warm up the browser session and capture anti-bot headers."""
        px = self.proxy if isinstance(self.proxy, Proxy) else Proxy(self.proxy)
        br = await AsyncCamoufox(
            headless=self.headless,
            proxy=px.as_dict(),
            humanize={{ app.humanize }},
            **self.browser_opts,
            block_images={{ app.block_images }},
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
        )
        await sniffer.start(self.ctx)

{% else %}
        sniffer = None

{% endif %}
        warmup = Warmup(
            browser=self.session,
            context=self.ctx,
            page=self.page,
            sniffer=sniffer,
            timeout_ms=self.timeout_ms,
            test_mode=self.test_mode,
            prefixes={
{% for prefix in prefixes %}
                {{ prefix.name | tojson }}: self.{{ prefix.attr_name }},
{% endfor %}
            },
        )

{% if warmup.script_module and warmup.script_function and warmup.script_path_expr %}
        from .{{ warmup.script_module }} import {{ warmup.script_function }} as warmup_runner
        await warmup_runner(warmup)
{% endif %}

        result_sniffer = await sniffer.complete() if sniffer else {"request": {}}

        result = defaultdict(set)

        for _url, headers in result_sniffer.get("request", {}).items():
            for header, values in headers.items():
                result[header].update(values)

        self.unstandard_headers = {k: list(v)[0] for k, v in result.items()}
{% for variable in variables %}
        self.{{ variable.backing_name }} = self._coerce_variable_value(
            {{ variable.capture_expr }},
            label={{ variable.name | tojson }},
            kind={{ variable.capture_kind | tojson }},
            pattern={{ variable.match_pattern if variable.match_pattern is not none else none }},
            error_message={{ variable.match_error if variable.match_error is not none else none }},
            range_value={{ variable.match_range if variable.match_range is not none else none }},
        )
{% endfor %}
        self.unstandard_urls = result_sniffer.get("request", {})

    async def __aexit__(self, *exc):
        await self.close()

    async def close(self):
        await self.session.close()

    @staticmethod
    def _coerce_variable_value(
        raw: Any,
        *,
        label: str,
        kind: str,
        pattern: str | None = None,
        error_message: str | None = None,
        range_value: tuple[int, int] | None = None,
    ) -> Any | None:
        if raw is None:
            return None
        if kind == "integer":
            value = raw if isinstance(raw, int) and not isinstance(raw, bool) else int(raw)
        elif kind == "number":
            value = raw if isinstance(raw, (int, float)) and not isinstance(raw, bool) else float(raw)
        elif kind == "boolean":
            if isinstance(raw, bool):
                value = raw
            elif isinstance(raw, str):
                lowered = raw.strip().lower()
                if lowered in {"true", "1", "yes", "on"}:
                    value = True
                elif lowered in {"false", "0", "no", "off"}:
                    value = False
                else:
                    raise ValueError(f"`{label}` must be boolean-like")
            else:
                value = bool(raw)
        elif kind == "null":
            return None
        else:
            value = raw if isinstance(raw, str) else str(raw)
        if pattern is not None and re.fullmatch(pattern, str(value)) is None:
            if error_message is not None:
                raise ValueError(error_message)
            raise ValueError(f"`{label}` does not match the expected format")
        if range_value is not None:
            if float(value) < range_value[0] or float(value) > range_value[1]:
                raise ValueError(f"`{label}` must be between {range_value[0]} and {range_value[1]}")
        return value

{% for variable in variables %}
{{ variable.code }}

{% endfor %}
    async def _request(
        self,
        method: HttpMethod,
        url: str,
        *,
        json_body: Any | None = None,
        mode: str | None = None,
        credentials: str | None = None,
        referrer: str | None = None,
        headers: dict[str, Any] | None = None,
    ) -> abstraction.Output:
        """Perform an HTTP request through the browser session."""
        request_headers = headers if headers is not None else {{ request.headers_expr }}
        response = await self.page.fetch(
            url=url,
            method=method,
            body=json_body,
            mode=mode if mode is not None else {{ request.cors_mode_expr }},
            credentials=credentials if credentials is not None else {{ request.credentials_expr }},
            timeout_ms=self.timeout_ms,
            referrer=referrer if referrer is not None else {{ request.referrer_expr }},
            headers=request_headers,
        )
        return abstraction.Output.from_fetch_response(response)

    async def _direct_request(
        self,
        url: str,
        *,
        retry_attempts: int = 3,
        timeout: float = 10,
    ) -> abstraction.Output:
        """Download raw bytes with retries, used by direct transport functions."""
        start_t = perf_counter()
        retry_options = ExponentialRetry(
            attempts=retry_attempts, start_timeout=3.0, max_timeout=timeout
        )
        px = self.proxy if isinstance(self.proxy, Proxy) else Proxy(self.proxy)
        async with RetryClient(retry_options=retry_options) as retry_client:
            async with retry_client.get(url, raise_for_status=True, proxy=px.as_str()) as resp:
                body = await resp.read()
                return abstraction.Output.from_raw(
                    body,
                    url=str(resp.url),
                    headers=dict(resp.headers),
                    status_code=resp.status,
                    status_text=resp.reason,
                    redirected=bool(resp.history),
                    response_type="basic",
                    duration=perf_counter() - start_t,
                    end_time=time(),
                    page=self.page,
                )
