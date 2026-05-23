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
{% if revalue_pattern %}
        if re.fullmatch({{ revalue_pattern }}, str(value)) is None:
{% if revalue_error %}
            raise ValueError({{ revalue_error }})
{% else %}
            raise ValueError("`{{ name }}` does not match the expected format")
{% endif %}
{% elif revalue_range %}
        if float(value) < {{ revalue_range[0] }} or float(value) > {{ revalue_range[1] }}:
            raise ValueError("`{{ name }}` must be between {{ revalue_range[0] }} and {{ revalue_range[1] }}")
{% endif %}
        self.{{ backing_name }} = value
{% endif %}
