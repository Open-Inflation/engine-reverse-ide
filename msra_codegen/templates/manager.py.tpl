from collections import defaultdict
from dataclasses import dataclass, field
from time import perf_counter, time
from typing import Any, cast
{% if has_autotests %}
from human_requests import autotest
{% endif %}
{% if uses_classvar_import %}
from typing import ClassVar
{% endif %}
{% if uses_literal_import %}
from typing import Literal
{% endif %}
{% if imports.overload %}
from typing import overload
{% endif %}
{% if imports.json %}
import json
{% endif %}
{% if imports.path %}
from pathlib import Path
{% endif %}
{% if imports.re %}
import re
{% endif %}
{% if imports.urlencode %}
from urllib.parse import urlencode
{% endif %}

from aiohttp_retry import ExponentialRetry, RetryClient
from camoufox import AsyncCamoufox, DefaultAddons
from human_requests import HumanBrowser, HumanPage
from human_requests.abstraction import HttpMethod, Proxy, Warmup
{% if imports.method_pipeline_error %}
from human_requests.abstraction import MethodPipelineError
{% endif %}
{% if uses_warmup_error_import %}
from human_requests.abstraction import WarmupError
{% endif %}
from human_requests.network_analyzer.anomaly_sniffer import HeaderAnomalySniffer

from . import abstraction
{% for group in top_groups %}
from .endpoints.{{ group.module_name }} import {{ group.class_name }}
{% endfor %}


@dataclass
class {{ client_class_name }}:
{% if app_description %}
    """{{ app_description }}"""

{% endif %}
    timeout_ms: int = {{ app.timeout_ms }}
    """Global timeout, in milliseconds, used by warmup and browser-backed requests."""
    headless: bool = True
    """Whether the browser is started without a visible window."""
    test_mode: bool = False
    """Enable the test-only warmup branch and its extra state."""
    proxy: str | dict | Proxy | None = None
    """Proxy settings for browser startup and direct requests. When omitted or set to None, the client reads the proxy from the environment."""
    browser_opts: dict[str, Any] | None = None
    """Extra keyword arguments forwarded to AsyncCamoufox during browser startup."""
{% if has_root_functions %}
    _parent: Any = field(init=False, repr=False)
{% endif %}

{% for prefix in prefixes %}
    {{ prefix.attr_name }}: ClassVar[str] = {{ prefix.value }}
{% endfor %}

{% for group in top_groups %}
    {{ group.field_name }}: {{ group.class_name }} = field(init=False)
{% if group.description %}
    """{{ group.description }}"""
{% endif %}
{% endfor %}

    def __post_init__(self):
        self.proxy = Proxy.from_env() if self.proxy is None else self.proxy
        browser_opts: dict[str, Any] = {} if self.browser_opts is None else dict(self.browser_opts)
        self.browser_opts = browser_opts
{% if has_root_functions %}
        self._parent = self
{% endif %}
        self.session = None
        self.ctx = None
        self.page = None
        self.unstandard_headers = {}
        self.unstandard_urls = {}

{% for variable in variables %}
        self.{{ variable.backing_name }} = None
{% endfor %}

{% for group in top_groups %}
        self.{{ group.field_name }} = {{ group.class_name }}(self)
{% endfor %}

{% for func in functions %}
{{ func.code }}

{% endfor %}
    async def __aenter__(self):
        await self._warmup()
        return self

    async def _warmup(self) -> None:
        px = self.proxy if isinstance(self.proxy, Proxy) else Proxy(self.proxy)
        browser_opts: dict[str, Any] = {} if self.browser_opts is None else dict(self.browser_opts)
        br = await AsyncCamoufox(
            headless=self.headless,
            proxy=px.as_dict(),
            humanize={{ app.humanize }},
            **browser_opts,
            block_images={{ app.block_images }},
            i_know_what_im_doing=True,
            exclude_addons=[DefaultAddons.UBO],
        ).start()

        self.session = HumanBrowser.replace(cast(Any, br))
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
{% if warmup.script_module and warmup.script_function and warmup.script_path_expr %}
        warmup = self._make_warmup_context(page=self.page, sniffer=sniffer)
        from .{{ warmup.script_module }} import {{ warmup.script_function }} as warmup_runner
        try:
            await warmup_runner(warmup)
        except WarmupError:
            raise
        except Exception as exc:
            raise WarmupError(str(exc)) from exc
{% endif %}

        result_sniffer: dict[str, Any] = await sniffer.complete() if sniffer else {"request": {}}

        result = defaultdict(set)

        for _url, headers in result_sniffer.get("request", {}).items():
            for header, values in headers.items():
                result[header].update(values)

        self.unstandard_headers = {k: list(v)[0] for k, v in result.items()}
{% for variable in variables %}
{{ variable.warmup_code }}

{% endfor %}
        self.unstandard_urls = result_sniffer.get("request", {})

    async def __aexit__(self, *exc):
        await self.close()

    async def close(self):
        await self.session.close()

    def _make_warmup_context(
        self,
        *,
        page: HumanPage,
        sniffer: HeaderAnomalySniffer | None,
    ) -> Warmup:
        return Warmup(
            browser=self.session,
            context=self.ctx,
            page=page,
            sniffer=sniffer,
            timeout_ms=self.timeout_ms,
            test_mode=self.test_mode,
            prefixes={
{% for prefix in prefixes %}
                {{ prefix.name | tojson }}: self.{{ prefix.attr_name }},
{% endfor %}
            },
        )

    async def _create_pipeline_sniffer(self) -> HeaderAnomalySniffer:
        sniffer = HeaderAnomalySniffer(
            include_subresources=True,
        )
        await sniffer.start(self.ctx)
        return sniffer

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
        request_headers = headers if headers is not None else {{ request.headers_expr }}
        fetch_kwargs: dict[str, Any] = {
            "url": url,
            "method": method,
            "body": json_body,
            "mode": mode if mode is not None else {{ request.cors_mode_expr }},
            "credentials": credentials if credentials is not None else {{ request.credentials_expr }},
            "timeout_ms": self.timeout_ms,
            "headers": request_headers,
        }
        if referrer is not None:
            fetch_kwargs["referrer"] = referrer
        response = await self.page.fetch(**fetch_kwargs)
        return abstraction.Output.from_fetch_response(response)

    async def _direct_request(
        self,
        url: str,
        *,
        retry_attempts: int = 3,
        timeout: float = 10,
    ) -> abstraction.Output:
        start_t = perf_counter()
        retry_options = ExponentialRetry(
            attempts=retry_attempts, start_timeout=3.0, max_timeout=timeout
        )
        px = self.proxy if isinstance(self.proxy, Proxy) else Proxy(self.proxy)
        async with (
            RetryClient(retry_options=retry_options) as retry_client,
            retry_client.get(url, raise_for_status=True, proxy=px.as_str()) as resp,
        ):
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
