from typing import Any
import re


class RegexBase:
    REGEX = r""
    ERROR = None

    @classmethod
    def match(cls, value: Any) -> bool:
        return re.fullmatch(cls.REGEX, str(value)) is not None


{% for regex in regexes %}
class {{ regex.class_name }}(RegexBase):
{% if regex.description %}
    """{{ regex.description }}"""
{% endif %}
    REGEX = r"{{ regex.pattern }}"
{% if regex.raise_message is not none %}
    ERROR = {{ regex.raise_message }}
{% endif %}


{% endfor %}
