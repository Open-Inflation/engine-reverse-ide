    @property
    def {{ name }}(self) -> {{ getter_return }}:
{% if description %}
        """{{ description }}"""
{% endif %}
        return self.{{ backing_name }}

{% if setter_enabled %}
    @{{ name }}.setter
    def {{ name }}(self, value: {{ getter_return }}) -> None:
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
{% if match_check_expr %}
        if not ({{ match_check_expr }}):
{% if match_error %}
            raise ValueError({{ match_error }})
{% else %}
            raise ValueError("`{{ name }}` does not match the expected format")
{% endif %}
{% elif match_range_lower is not none or match_range_upper is not none %}
{% if match_range_lower is not none and match_range_upper is not none %}
        if float(value) < {{ match_range_lower }} or float(value) > {{ match_range_upper }}:
            raise ValueError("`{{ name }}` must be between {{ match_range_lower }} and {{ match_range_upper }}")
{% elif match_range_lower is not none %}
        if float(value) < {{ match_range_lower }}:
            raise ValueError("`{{ name }}` must be greater than or equal to {{ match_range_lower }}")
{% else %}
        if float(value) > {{ match_range_upper }}:
            raise ValueError("`{{ name }}` must be less than or equal to {{ match_range_upper }}")
{% endif %}
{% elif match_values_expr %}
        allowed_values = {{ match_values_expr }}
        if value not in allowed_values:
            raise ValueError(f"`{{ name }}` must be one of {allowed_values}")
{% endif %}
        self.{{ backing_name }} = value
{% endif %}
