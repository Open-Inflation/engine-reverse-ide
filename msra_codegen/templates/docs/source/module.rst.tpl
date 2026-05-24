{{ title }}
{{ title_underline }}

{% if description %}
{{ description }}

{% endif %}
.. currentmodule:: {{ import_path }}

.. automodule:: {{ import_path }}

{% if class_names %}
.. rubric:: Classes

{% for class_name in class_names %}
.. autoclass:: {{ class_name }}
   :members:
   :undoc-members:
   :show-inheritance:

{% endfor %}

{% endif %}
{% if child_pages %}
.. rubric:: Submodules

.. toctree::
   :maxdepth: 1

{% for child_docname in child_docnames %}
   {{ child_docname }}
{% endfor %}

{% endif %}
