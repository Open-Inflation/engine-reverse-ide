"""Unified response wrapper generated from MSRA."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from io import BytesIO
from time import time
from typing import TYPE_CHECKING, Any

from human_requests.abstraction import FetchResponse

if TYPE_CHECKING:
    from playwright.async_api import Response as PWResponse


def _coerce_bytes(raw: bytes | bytearray | memoryview | str) -> bytes:
    if isinstance(raw, bytes):
        return raw
    if isinstance(raw, bytearray):
        return bytes(raw)
    if isinstance(raw, memoryview):
        return raw.tobytes()
    return raw.encode("utf-8", "replace")


def _normalize_headers(headers: dict[str, Any] | None) -> dict[str, str]:
    result: dict[str, str] = {}
    for key, value in (headers or {}).items():
        result[str(key).lower()] = "" if value is None else str(value)
    return result


def _url_string(url: Any | None) -> str | None:
    if url is None:
        return None
    return getattr(url, "full_url", None) or str(url)


def _decode_text(raw: bytes, headers: dict[str, str]) -> str:
    content_type = headers.get("content-type", "")
    charset = "utf-8"
    if "charset=" in content_type:
        charset = content_type.split("charset=", 1)[-1].split(";", 1)[0].strip() or charset
    return raw.decode(charset, errors="replace")


class _AwaitableBytes(bytes):
    def __new__(cls, value: bytes | bytearray | memoryview | str) -> "_AwaitableBytes":
        return bytes.__new__(cls, _coerce_bytes(value))

    def __call__(self) -> "_AwaitableBytes":
        return self

    def __await__(self):
        async def _value() -> bytes:
            return bytes(self)

        return _value().__await__()


class _AwaitableStr(str):
    def __new__(cls, value: Any) -> "_AwaitableStr":
        return str.__new__(cls, str(value))

    def __call__(self) -> "_AwaitableStr":
        return self

    def __await__(self):
        async def _value() -> str:
            return str(self)

        return _value().__await__()


class _AwaitableList(list):
    def __init__(self, value=()):
        super().__init__(value)

    def __call__(self) -> "_AwaitableList":
        return self

    def __await__(self):
        async def _value() -> list[Any]:
            return list(self)

        return _value().__await__()


class _AwaitableDict(dict):
    def __init__(self, value=None):
        super().__init__({} if value is None else value)

    def __call__(self) -> "_AwaitableDict":
        return self

    def __await__(self):
        async def _value() -> dict[str, Any]:
            return dict(self)

        return _value().__await__()


class _AwaitableValue:
    def __init__(self, value: Any):
        self._value = value

    def __call__(self) -> "_AwaitableValue":
        return self

    def __await__(self):
        async def _value() -> Any:
            return self._value

        return _value().__await__()

    def __getattr__(self, name: str) -> Any:
        return getattr(self._value, name)

    def __repr__(self) -> str:
        return repr(self._value)

    def __str__(self) -> str:
        return str(self._value)

    def __bool__(self) -> bool:
        return bool(self._value)

    def __eq__(self, other: Any) -> bool:
        return self._value == other


def _wrap_awaitable(value: Any) -> Any:
    if isinstance(value, bytes):
        return _AwaitableBytes(value)
    if isinstance(value, str):
        return _AwaitableStr(value)
    if isinstance(value, list):
        return _AwaitableList(value)
    if isinstance(value, dict):
        return _AwaitableDict(value)
    return _AwaitableValue(value)


@dataclass
class Output:
    """Unified response-like object for generated clients."""

    raw: bytes = field(repr=False)
    headers: dict[str, str] = field(default_factory=dict)
    url: str | None = None
    status_code: int | None = None
    status_text: str | None = None
    redirected: bool | None = None
    response_type: str | None = None
    duration: float | None = None
    end_time: float | None = None
    request: Any | None = None
    page: Any | None = None
    _fetch_response: FetchResponse | None = field(default=None, repr=False)
    _pw_response: Any | None = field(default=None, repr=False)
    _json_override: Any | None = field(default=None, repr=False)
    _text_override: str | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        self.raw = _coerce_bytes(self.raw)
        self.headers = _normalize_headers(self.headers)
        if self.status_code is not None:
            self.status_code = int(self.status_code)

    @classmethod
    def from_fetch_response(
        cls,
        response: FetchResponse,
        *,
        json_override: Any | None = None,
        text_override: str | None = None,
    ) -> "Output":
        return cls(
            raw=response.raw,
            headers=getattr(response, "headers", {}) or {},
            url=_url_string(response.url),
            status_code=response.status_code,
            status_text=response.status_text,
            redirected=response.redirected,
            response_type=response.type,
            duration=response.duration,
            end_time=response.end_time,
            request=response.request,
            page=response.page,
            _fetch_response=response,
            _json_override=json_override,
            _text_override=text_override,
        )

    @classmethod
    def from_raw(
        cls,
        raw: bytes | bytearray | memoryview | str,
        *,
        url: str | None = None,
        headers: dict[str, Any] | None = None,
        status_code: int | None = None,
        status_text: str | None = None,
        redirected: bool | None = None,
        response_type: str | None = None,
        duration: float | None = None,
        end_time: float | None = None,
        request: Any | None = None,
        page: Any | None = None,
        json_override: Any | None = None,
        text_override: str | None = None,
    ) -> "Output":
        return cls(
            raw=raw,
            headers=headers or {},
            url=_url_string(url),
            status_code=status_code,
            status_text=status_text,
            redirected=redirected,
            response_type=response_type,
            duration=duration,
            end_time=end_time if end_time is not None else time(),
            request=request,
            page=page,
            _json_override=json_override,
            _text_override=text_override,
        )

    @classmethod
    async def from_playwright_response(
        cls,
        response: "PWResponse",
        *,
        page: Any | None = None,
        json_override: Any | None = None,
        text_override: str | None = None,
    ) -> "Output":
        raw = await response.body()
        headers = await response.all_headers()
        return cls(
            raw=raw,
            headers=headers,
            url=_url_string(getattr(response, "url", None)),
            status_code=getattr(response, "status", None),
            status_text=getattr(response, "status_text", None),
            redirected=None,
            response_type=None,
            duration=0.0,
            end_time=time(),
            request=getattr(response, "request", None),
            page=page,
            _pw_response=response,
            _json_override=json_override,
            _text_override=text_override,
        )

    @property
    def status(self) -> int | None:
        return self.status_code

    @property
    def text(self) -> str:
        if self._text_override is not None:
            return _AwaitableStr(self._text_override)
        return _AwaitableStr(_decode_text(self.raw, self.headers))

    def body(self) -> bytes:
        return _AwaitableBytes(self.raw)

    def json(self) -> Any:
        if self._json_override is not None:
            value = self._json_override() if callable(self._json_override) else self._json_override
            return _wrap_awaitable(value)
        return _wrap_awaitable(json.loads(str(self.text)))

    def image(self):
        from PIL import Image

        image = Image.open(BytesIO(self.raw))
        image.load()
        return image

    def all_headers(self) -> dict[str, str]:
        return _AwaitableDict(self.headers)

    def header_value(self, name: str) -> str | None:
        value = self.headers.get(name.lower())
        if value is None:
            return None
        return _AwaitableStr(value)

    def header_values(self, name: str) -> list[str]:
        value = self.header_value(name)
        if value is None:
            return _AwaitableList()
        return _AwaitableList([value])

    def headers_array(self) -> list[dict[str, str]]:
        return _AwaitableList([{"name": key, "value": value} for key, value in self.headers.items()])

    def seconds_ago(self) -> float:
        if self.end_time is None:
            return 0.0
        return time() - self.end_time

    async def render(
        self,
        retry: int = 2,
        timeout: float | None = None,
        wait_until: str = "commit",
        referer: str | None = None,
    ) -> Any:
        if self._fetch_response is not None:
            return await self._fetch_response.render(
                retry=retry,
                timeout=timeout,
                wait_until=wait_until,
                referer=referer,
            )
        if self.page is None:
            raise RuntimeError("render() requires a page for direct or PW outputs")
        if self.url is None:
            raise RuntimeError("render() requires a url")
        return await self.page.goto_render(
            self.url,
            body=self.raw,
            status_code=self.status_code or 200,
            headers=dict(self.headers),
            retry=retry,
            timeout=timeout,
            wait_until=wait_until,
            referer=referer,
        )

    def __bytes__(self) -> bytes:
        return self.raw

    def __len__(self) -> int:
        return len(self.raw)

    def __getattr__(self, name: str) -> Any:
        for source in (self._fetch_response, self._pw_response):
            if source is not None and hasattr(source, name):
                return getattr(source, name)
        raise AttributeError(name)
