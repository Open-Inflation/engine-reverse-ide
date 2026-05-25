{% for line in imports -%}
{{ line }}
{% endfor %}

from . import abstraction, endpoints, manager
from .manager import Warmup

__all__ = ["{{ client_class_name }}", "Warmup"{% for export in exports %}, "{{ export }}"{% endfor %}]
__version__ = "{{ version }}"
