<div align="center">

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

Для более подробной информации смотрите референсы [документации]({{ readme.docs_url }}).
