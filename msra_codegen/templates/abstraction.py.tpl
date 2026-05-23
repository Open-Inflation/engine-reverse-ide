"""Shared generated constants and enums."""

{% for regex in regexes %}
{{ regex.name }} = r"{{ regex.pattern }}"
{% if regex.raise %}
# {{ regex.raise }}
{% endif %}

{% endfor %}
{% if has_catalog_sort %}
class CatalogSort:
    """Sort order helper generated from MSRA values."""

    POPULARITY = "sold"
    """Most popular first."""

    ALPHABET = "abc"

    class Price:
        """Sort by price."""

        ASC = "min"
        """Cheapest first."""

        DESC = "max"
        """Most expensive first."""
{% endif %}
