{% for line in imports -%}
{{ line }}
{% endfor %}

from . import abstraction, endpoints, manager

__all__ = ["{{ client_class_name }}"{% for export in exports %}, "{{ export }}"{% endfor %}]
__version__ = "{{ version }}"
