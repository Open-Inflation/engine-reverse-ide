    @property
    def {{ name }}(self) -> {{ getter_return }}:
        """{{ description }}"""
        return self.{{ backing_name }}

{% if setter_enabled %}
    @{{ name }}.setter
    def {{ name }}(self, value) -> None:
{% if has_null %}
        if value is None:
            self.{{ backing_name }} = None
            return

{% endif %}
{% if has_integer %}
        if not isinstance(value, int) or isinstance(value, bool):
            raise TypeError("`{{ name }}` must be int")
{% elif has_boolean %}
        if not isinstance(value, bool):
            raise TypeError("`{{ name }}` must be bool")
{% elif has_number %}
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise TypeError("`{{ name }}` must be number")
{% else %}
        if not isinstance(value, str):
            raise TypeError("`{{ name }}` must be str")
{% endif %}
{% if match_pattern %}
        if re.fullmatch({{ match_pattern }}, str(value)) is None:
{% if match_error %}
            raise ValueError({{ match_error }})
{% else %}
            raise ValueError("`{{ name }}` does not match the expected format")
{% endif %}
{% elif match_range %}
        if float(value) < {{ match_range[0] }} or float(value) > {{ match_range[1] }}:
            raise ValueError("`{{ name }}` must be between {{ match_range[0] }} and {{ match_range[1] }}")
{% endif %}
        self.{{ backing_name }} = value
{% endif %}
