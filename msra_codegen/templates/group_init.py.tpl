from . import {{ module_stem }} as _{{ module_stem }}
{% for child in child_imports %}
from . import {{ child.package_name }} as _{{ child.package_name }}
{% endfor %}

{{ class_name }} = _{{ module_stem }}.{{ class_name }}
{% for child in child_imports %}
{{ child.class_name }} = _{{ child.package_name }}.{{ child.class_name }}
{% endfor %}

__all__ = [
    "{{ class_name }}"{% for child in child_imports %},
    "{{ child.class_name }}"{% endfor %}
]
