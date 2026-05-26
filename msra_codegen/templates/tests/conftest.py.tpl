from __future__ import annotations

import pytest

from {{ package_name }} import {{ client_class_name }}


@pytest.fixture(scope="session")
def anyio_backend():
    return "asyncio"


@pytest.fixture(scope="session")
async def api():
    async with {{ client_class_name }}(test_mode=True) as client:
        yield client
{{ "\n" if fixtures else "" }}
{% for fixture in fixtures %}
{{ fixture.code }}
{{ "\n" if not loop.last else "" }}
{% endfor %}
