<div align="center">

{% if readme.logo %}
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="{{ readme.logo.dark_readme_path }}">
    <img alt="{{ readme.logo.alt }}" src="{{ readme.logo.light_readme_path }}">
  </picture>
</p>

{% endif %}
# {{ readme.title }}

![Tests last run (ISO)]({{ readme.workflow_last_run_badge_url }})
[![Tests]({{ readme.workflow_badge_url }})]({{ readme.workflow_url }})
![PyPI - Python Version]({{ readme.pypi_python_badge_url }})
![PyPI - Package Version]({{ readme.pypi_version_badge_url }})
[![PyPI - Downloads]({{ readme.pypi_downloads_badge_url }})]({{ readme.pypi_project_url }})
[![License]({{ readme.license_badge_url }})]({{ readme.license_url }})
{% for social in readme.socials %}
[![{{ social.label }}]({{ social.badge_url }})]({{ social.url }})
{% endfor %}

{% if readme.description %}
{{ readme.description }}
{% endif %}

**[⭐ Star us on GitHub]({{ readme.repo_url }})** | **[📚 Read the Docs]({{ readme.docs_url }})** | **[🐛 Report Bug]({{ readme.issues_url }})**

### Принцип работы

</div>

> {{ readme.principle_text }}

<div align="center">

# Usage

</div>

```bash
pip install {{ package_name }}
{% if quick_start.requires_camoufox %}
python -m camoufox fetch
{% endif %}
```

```py
{{ pipeline_script_code }}
```

{% if tests.has_autotests %}
## Автотесты API (pytest + snapshots)

В проекте используется автотест-фреймворк из `human_requests`:

- endpoint-методы в бизнес-коде помечаются `@autotest`;
- pytest-плагин сам находит эти методы и запускает их;
- JSON-ответы проверяются через `pytest-jsonschema-snapshot` (`schemashot`);
- параметры вызова и пост-обработка результата регистрируются в `tests/api_test.py` через:
  - `@autotest_params`
  - `@autotest_hook`
  - `@autotest_depends_on`

Минимальная конфигурация уже включена в `pyproject.toml`:

```ini
[tool.pytest.ini_options]
anyio_mode = "auto"
autotest_start_class = "{{ tests.autotest_start_class }}"
```

Запуск тестов:

```bash
pytest
```

Важно:

- используется `pytest-anyio` (не `pytest-asyncio`);
- ручные тесты остаются только для кейсов, которые не относятся к JSON-схемам endpoint-методов (например, `download_image`).
{% endif %}

Для более подробной информации смотрите референсы [документации]({{ readme.docs_url }}).

<div align="center">

### Report

If you have any problems using it / suggestions, do not hesitate to write to the [project's GitHub]({{ readme.issues_url }})!

</div>
