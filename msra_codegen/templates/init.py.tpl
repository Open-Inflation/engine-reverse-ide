from . import abstraction as _abstraction
from . import endpoints as _endpoints
from . import manager as _manager

abstraction = _abstraction
endpoints = _endpoints
manager = _manager

{% for export in exports %}
{{ export }} = abstraction.{{ export }}
{% endfor %}
{{ client_class_name }} = manager.{{ client_class_name }}
Warmup = manager.Warmup

__all__ = ["{{ client_class_name }}", "Warmup"{% for export in exports %}, "{{ export }}"{% endfor %}]
__version__ = "{{ version }}"
