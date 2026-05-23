{% for line in imports -%}
{{ line }}
{% endfor %}

__all__ = ["{{ client_class_name }}"{% for export in exports %}, "{{ export }}"{% endfor %}]
__version__ = "{{ version }}"
