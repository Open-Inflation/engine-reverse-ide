"""Generated endpoints for {{ group_name }}."""

from __future__ import annotations

import json
from pathlib import Path
from types import MethodType
import re
from typing import TYPE_CHECKING, Any, Literal

from human_requests import autotest
from human_requests.abstraction import FetchResponse, HttpMethod
from human_requests.network_analyzer.anomaly_sniffer import WaitHeader, WaitSource
from playwright.async_api import Response as PWResponse
from urllib.parse import urlencode

from {{ root_import_prefix }} import abstraction
{% for child in child_imports %}
from .{{ child.package_name }} import {{ child.class_name }}
{% endfor %}

if TYPE_CHECKING:
    from {{ root_import_prefix }}manager import {{ root_client_name }}


class {{ class_name }}:
    """{{ description }}"""

    def __init__(self, parent: "{{ root_client_name }}"):
        self._parent = parent
{% for child in children %}
        self.{{ child.field_name }}: {{ child.class_name }} = {{ child.class_name }}(parent)
{% endfor %}

{% for func in functions %}
{{ func.code }}

{% endfor %}
