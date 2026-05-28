from human_requests.abstraction import Output as _Output

{% if has_regexes %}
{% for regex in regexes %}
from .regexes import {{ regex.class_name }} as _{{ regex.class_name }}
{% endfor %}
{% endif %}
{% if has_catalog_sort %}
from .catalog_sort import CatalogSort as _CatalogSort
{% endif %}

Output = _Output
{% if has_regexes %}
{% for regex in regexes %}
{{ regex.class_name }} = _{{ regex.class_name }}
{% endfor %}
{% endif %}
{% if has_catalog_sort %}
CatalogSort = _CatalogSort
{% endif %}

__all__ = [
    "Output",
{% for regex in regexes %}
    "{{ regex.class_name }}",
{% endfor %}
{% if has_catalog_sort %}
    "CatalogSort",
{% endif %}
]
