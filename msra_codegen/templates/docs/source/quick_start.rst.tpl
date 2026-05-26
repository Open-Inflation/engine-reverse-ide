{{ quick_start.title }}
{{ quick_start.title_underline }}

Install the generated client:

.. code-block:: console

    pip install {{ package_name }}
{% if quick_start.requires_camoufox %}
    python -m camoufox fetch
{% endif %}

Import the client:

.. code-block:: python

{{ pipeline_script_code_rst }}

The public API is documented in :doc:`api`.
