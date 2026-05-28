{% if top_groups %}
{% for group in top_groups %}
from . import {{ group.package_name }} as _{{ group.package_name }}
{% endfor %}

{% for group in top_groups %}
{{ group.class_name }} = _{{ group.package_name }}.{{ group.class_name }}
{% endfor %}
{% endif %}

__all__ = [
{% for group in top_groups %}
    "{{ group.class_name }}",
{% endfor %}
]
