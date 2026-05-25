{% for regex in regexes %}
class {{ regex.class_name }}:
{% if regex.description %}
    """{{ regex.description }}"""
{% endif %}

    REGEX = r"{{ regex.pattern }}"
    ERROR = {{ regex.raise_message if regex.raise_message is not none else "None" }}


{% endfor %}
