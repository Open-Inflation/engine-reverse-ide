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

Use `example.py` for the runnable example. The same code is duplicated below and reused in the Sphinx quick start.

```py
{{ pipeline_script_code }}
```

The generated docs are available in `docs/`.
