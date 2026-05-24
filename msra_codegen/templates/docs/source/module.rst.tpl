{{ title }}
{{ title_underline }}

{% if description %}
{{ description }}

{% endif %}
.. automodule:: {{ import_path }}
   :members:
   :show-inheritance:
   :undoc-members:

{% if class_names %}
.. rubric:: Classes

.. autosummary::

{% for class_ref in class_refs %}
   {{ class_ref }}
{% endfor %}

{% endif %}
{% if child_pages %}
.. rubric:: Submodules

.. autosummary::
   :toctree: _api

{% for child_page in child_pages %}
   {{ child_page }}
{% endfor %}

{% endif %}
{% if child_pages %}
.. toctree::
   :hidden:

{% for child_docname in child_docnames %}
   {{ child_docname }}
{% endfor %}

{% endif %}
