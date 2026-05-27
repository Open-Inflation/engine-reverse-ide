{% for line in imports -%}
{{ line }}
{% endfor %}

from . import abstraction, endpoints, manager  # noqa: F401
from .manager import Warmup  # noqa: F401

__all__ = ["{{ client_class_name }}", "Warmup"{% for export in exports %}, "{{ export }}"{% endfor %}]
__version__ = "{{ version }}"
