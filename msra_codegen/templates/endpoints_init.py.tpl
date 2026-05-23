"""Generated endpoint packages."""

{% for group in top_groups %}
from .{{ group.package_name }} import {{ group.class_name }}
{% endfor %}

__all__ = [
{% for group in top_groups %}
    "{{ group.class_name }}",
{% endfor %}
]
