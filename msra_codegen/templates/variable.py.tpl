    @property
    def {{ name }}(self) -> {{ getter_return }}:
        """{{ description }}"""
        raw = self.unstandard_headers.get({{ header_expr }}, None)
{% if has_integer %}
        if raw is None:
            return None
        return int(raw)
{% else %}
        return raw
{% endif %}

{% if setter_enabled %}
    @{{ name }}.setter
    def {{ name }}(self, value) -> None:
{% if has_null %}
        if value is None:
            self.unstandard_headers.pop({{ header_expr }}, None)
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
            raise ValueError("`{{ name }}` does not match the expected format")
{% elif revalue_range %}
        if float(value) < {{ revalue_range[0] }} or float(value) > {{ revalue_range[1] }}:
            raise ValueError("`{{ name }}` must be between {{ revalue_range[0] }} and {{ revalue_range[1] }}")
{% endif %}
        self.unstandard_headers.update({{ "{" }}{{ header_expr }}: str(value){{ "}" }})
{% endif %}
