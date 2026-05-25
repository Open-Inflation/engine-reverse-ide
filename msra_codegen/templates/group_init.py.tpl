from . import {{ module_stem }}
from .{{ module_stem }} import {{ class_name }}
{% for child in child_imports %}
from . import {{ child.package_name }}
from .{{ child.package_name }} import {{ child.class_name }}
{% endfor %}

__all__ = [
    "{{ class_name }}"{% for child in child_imports %},
    "{{ child.class_name }}"{% endfor %}
]
