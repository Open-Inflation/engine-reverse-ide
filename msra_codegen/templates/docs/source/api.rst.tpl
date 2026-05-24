API Reference
=============

.. autosummary::
   :recursive:
   :toctree: _api

   {{ package_name }}.endpoints
   {{ package_name }}.manager

.. toctree::
   :hidden:

{% for docname in api_docnames %}
   {{ docname }}
{% endfor %}
