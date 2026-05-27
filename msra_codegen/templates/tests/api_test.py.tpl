from __future__ import annotations

from typing import Any  # noqa: F401

import pytest  # noqa: F401
from human_requests import autotest_data, autotest_depends_on, autotest_hook, autotest_params  # noqa: F401
from human_requests.autotest import AutotestCallContext, AutotestContext, AutotestDataContext  # noqa: F401

{% for import in imports %}
from {{ import.module }} import {{ import.class_name }}
{% endfor %}

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
