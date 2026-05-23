"""Shared regex patterns and their validation messages."""

{% for regex in regexes %}
class {{ regex.class_name }}:
    """Shared regex patterns and their validation messages."""

    REGEX = r"{{ regex.pattern }}"
    ERROR = {{ regex.raise_message if regex.raise_message is not none else "None" }}


{% endfor %}
