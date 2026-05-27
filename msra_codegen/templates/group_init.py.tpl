from . import {{ module_stem }}  # noqa: F401
from .{{ module_stem }} import {{ class_name }}  # noqa: F401
{% for child in child_imports %}
from . import {{ child.package_name }}  # noqa: F401
from .{{ child.package_name }} import {{ child.class_name }}  # noqa: F401
{% endfor %}

__all__ = [
    "{{ class_name }}"{% for child in child_imports %},
    "{{ child.class_name }}"{% endfor %}
]
