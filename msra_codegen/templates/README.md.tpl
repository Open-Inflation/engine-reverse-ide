# {{ project_name }}

Generated async client for `{{ package_name }}`.

## Quick Start

Install the generated client:

```bash
pip install {{ package_name }}
{% if quick_start.requires_camoufox %}
python -m camoufox fetch
{% endif %}
```

Import the client:

```py
import asyncio
from {{ package_name }} import {{ client_class_name }}{% if quick_start.has_catalog_sort %}, CatalogSort{% endif %}

async def main():
    async with {{ client_class_name }}() as api:
        pass

if __name__ == "__main__":
    asyncio.run(main())
```

## Usage

```py
{{ readme_pipeline_code }}
```

{% if readme_pipeline_note %}
{{ readme_pipeline_note }}
{% endif %}

For more detailed information, see the generated docs in `docs/`.
