{{ quick_start.title }}
{{ quick_start.title_underline }}

Install the generated client:

.. code-block:: console

    pip install {{ package_name }}

Import the client:

.. code-block:: python

    import asyncio
    from {{ package_name }} import {{ client_class_name }}{% if quick_start.has_catalog_sort %}, CatalogSort{% endif %}

    async def main():
        async with {{ client_class_name }}() as api:
{% for group in top_groups %}
            # {{ group.field_name }}: {{ group.description or group.class_name }}
{% endfor %}
            pass

    if __name__ == "__main__":
        asyncio.run(main())

The public API is documented in :doc:`{{ package_name }}` and :doc:`api`.
