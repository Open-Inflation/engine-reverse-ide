{% from "pipeline_macros.tpl" import render_pipeline_steps %}
    @autotest
    async def {{ method_name }}(self{% if signature %}, {{ signature }}{% endif %}) -> {{ return_annotation }}:
        """{{ description }}"""
{% for item in validation %}
{% if item.required %}
        if {{ item.name }} is None:
            raise ValueError("`{{ item.name }}` is required")
{% endif %}
{% set indent = "            " if not item.required else "        " %}
{% if not item.required %}
        if {{ item.name }} is not None:
{% endif %}
{% if "integer" in item.type_names %}
{{ indent }}if not isinstance({{ item.name }}, int) or isinstance({{ item.name }}, bool):
{{ indent }}    raise TypeError("`{{ item.name }}` must be int")
{% elif "boolean" in item.type_names %}
{{ indent }}if not isinstance({{ item.name }}, bool):
{{ indent }}    raise TypeError("`{{ item.name }}` must be bool")
{% elif "number" in item.type_names %}
{{ indent }}if not isinstance({{ item.name }}, (int, float)) or isinstance({{ item.name }}, bool):
{{ indent }}    raise TypeError("`{{ item.name }}` must be number")
{% elif "string" in item.type_names %}
{{ indent }}if not isinstance({{ item.name }}, str):
{{ indent }}    raise TypeError("`{{ item.name }}` must be str")
{% endif %}
{% if item.revalue_pattern %}
{{ indent }}if re.fullmatch({{ item.revalue_pattern }}, str({{ item.name }})) is None:
{% if item.revalue_error %}
{{ indent }}    raise ValueError({{ item.revalue_error }})
{% else %}
{{ indent }}    raise ValueError("`{{ item.name }}` does not match the expected format")
{% endif %}
{% elif item.revalue_range %}
{{ indent }}if float({{ item.name }}) < {{ item.revalue_range[0] }} or float({{ item.name }}) > {{ item.revalue_range[1] }}:
{{ indent }}    raise ValueError("`{{ item.name }}` must be between {{ item.revalue_range[0] }} and {{ item.revalue_range[1] }}")
{% endif %}
{% if item.values_expr %}
{{ indent }}if {{ item.name }} not in {{ item.values_expr }}:
{{ indent }}    raise ValueError("`{{ item.name }}` must be one of {{ item.values_expr }}")
{% endif %}
{% endfor %}

        url = {{ url_expr }}
        query_params = []
{% for param in query_params %}
{% if param.kind == "data" %}
        if {{ param.value_expr }} is not None:
            query_params.append(({{ param.name_expr }}, {{ param.value_expr }}))
{% elif param.kind == "boolean_literal" %}
        if {{ param.input_name }}:
            query_params.append(({{ param.name_expr }}, {{ param.value_expr }}))
{% elif param.kind == "literal" %}
        query_params.append(({{ param.name_expr }}, {{ param.value_expr }}))
{% elif param.kind == "input_passthrough" %}
        if {{ param.input_name }} is not None:
            query_params.append(({{ param.name_expr }}, {{ param.input_name }}))
{% endif %}
{% endfor %}
        if query_params:
            url += "?" + urlencode(query_params, doseq=True)

{% if transport == "direct" %}
        return await self._parent._direct_request(url, {{ direct_args | join(", ") }})
{% elif transport == "goto" %}
        page = await self._parent.ctx.new_page()
        try:
            resp = await page.goto(url, wait_until="domcontentloaded")
            if resp is None:
                raise RuntimeError("page.goto() returned None")
{% if postprocess.render_html %}
            await page.wait_for_load_state("networkidle")
{% endif %}
{% if postprocess.goto_pipeline %}
{{ render_pipeline_steps(postprocess.goto_pipeline, "            ", "page", none, none) }}
{% endif %}
{% if postprocess.evaluate_path_expr %}
            evaluate_script = (Path(__file__).resolve().parent / {{ postprocess.evaluate_path_expr }}).read_text(encoding="utf-8")
            evaluate_result = await page.evaluate(evaluate_script)
            if isinstance(evaluate_result, dict):
                result_type = str(evaluate_result.get("type", "")).lower()
                if result_type in {"json", "text/json"}:
                    payload = json.loads(evaluate_result.get("data", "null"))

                    def _json(self):
                        return payload

                    resp.json = MethodType(_json, resp)
                elif result_type in {"text", "text/plain"}:
                    payload = str(evaluate_result.get("data", ""))

                    def _text(self):
                        return payload

                    resp.text = MethodType(_text, resp)
{% endif %}
            return resp
        finally:
            await page.close()
{% else %}
{% if body_expr is not none %}
        json_body = {{ body_expr }}
{% else %}
        json_body = None
{% endif %}
        return await self._parent._request(
            HttpMethod.{{ method }},
            url=url,
            json_body=json_body,
        )
{% endif %}
