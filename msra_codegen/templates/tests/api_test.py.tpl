from __future__ import annotations

{% if hooks or providers or data_cases %}
from typing import TYPE_CHECKING
{% endif %}

{% if providers %}
import pytest
{% endif %}
{% if hooks or providers %}
from human_requests import autotest_depends_on, autotest_hook, autotest_params
{% endif %}
{% if data_cases %}
from human_requests import autotest_data
{% endif %}

{% for import in imports %}
from {{ import.module }} import {{ import.class_name }}
{% endfor %}

{% if hooks or providers or data_cases %}
if TYPE_CHECKING:
{% if hooks %}
    from human_requests.autotest import AutotestContext
{% endif %}
{% if providers %}
    from human_requests.autotest import AutotestCallContext
{% endif %}
{% if data_cases %}
    from human_requests.autotest import AutotestDataContext
{% endif %}

{% endif %}
{% for hook in hooks %}
{{ hook.hook_code }}

{% endfor %}
{% for provider in providers %}
{{ provider.provider_code }}

{% endfor %}
{% for data_case in data_cases %}
{{ data_case.code }}

{% endfor %}
{% for manual_test in manual_tests %}
{{ manual_test.code }}

{% endfor %}
