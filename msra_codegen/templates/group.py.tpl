from __future__ import annotations

from typing import TYPE_CHECKING

{% if has_autotests %}
from human_requests import autotest
{% endif %}
{% if imports.literal %}
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
{% if imports.http_method %}
from human_requests.abstraction import HttpMethod
{% endif %}
{% if imports.method_pipeline_error %}
from human_requests.abstraction import MethodPipelineError
{% endif %}
from urllib.parse import urlencode

from {{ root_import_prefix }} import abstraction
{% for child in child_imports %}
from .{{ child.package_name }} import {{ child.class_name }}
{% endfor %}

if TYPE_CHECKING:
    from {{ root_import_prefix }}manager import {{ root_client_name }}


class {{ class_name }}:
{% if description %}
    """{{ description }}"""
{% endif %}

    def __init__(self, parent: {{ root_client_name }}):
        self._parent = parent
{% for child in children %}
        self.{{ child.field_name }}: {{ child.class_name }} = {{ child.class_name }}(parent)
{% endfor %}

{% for func in functions %}
{{ func.code }}

{% endfor %}
