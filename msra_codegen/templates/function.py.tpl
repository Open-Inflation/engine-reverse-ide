{% if autotest_enabled %}
    @autotest
{% endif %}
    async def {{ method_name }}(self{% if signature %}, {{ signature }}{% endif %}) -> {{ return_annotation }}:
{% if description %}
        """{{ description }}"""
{% endif %}
{% for item in validation %}
{% if item.has_checks %}
{% if item.required %}
        if {{ item.name }} is None:
            raise ValueError("`{{ item.name }}` is required")
{% endif %}
{% set indent = "            " if not item.required else "        " %}
{% if not item.required %}
        if {{ item.name }} is not None:
{% endif %}
{% if item.is_list %}
{{ indent }}if not isinstance({{ item.name }}, list):
{{ indent }}    raise TypeError("`{{ item.name }}` must be list")
{{ indent }}for __item in {{ item.name }}:
{% if "integer" in item.item_type_names %}
{{ indent }}    if not isinstance(__item, int) or isinstance(__item, bool):
{{ indent }}        raise TypeError("`{{ item.name }}` items must be int")
{% elif "boolean" in item.item_type_names %}
{{ indent }}    if not isinstance(__item, bool):
{{ indent }}        raise TypeError("`{{ item.name }}` items must be bool")
{% elif "number" in item.item_type_names %}
{{ indent }}    if not isinstance(__item, (int, float)) or isinstance(__item, bool):
{{ indent }}        raise TypeError("`{{ item.name }}` items must be number")
{% elif "string" in item.item_type_names %}
{{ indent }}    if not isinstance(__item, str):
{{ indent }}        raise TypeError("`{{ item.name }}` items must be str")
{% endif %}
{% else %}
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
{% endif %}
{% if item.match_check_expr and not item.is_list %}
{{ indent }}if not ({{ item.match_check_expr }}):
{% if item.match_error %}
{{ indent }}    raise ValueError({{ item.match_error }})
{% else %}
{{ indent }}    raise ValueError("`{{ item.name }}` does not match the expected format")
{% endif %}
{% elif item.match_range and not item.is_list %}
{{ indent }}if float({{ item.name }}) < {{ item.match_range[0] }} or float({{ item.name }}) > {{ item.match_range[1] }}:
{{ indent }}    raise ValueError("`{{ item.name }}` must be between {{ item.match_range[0] }} and {{ item.match_range[1] }}")
{% endif %}
{% if item.values_expr %}
{% if item.is_list %}
{{ indent }}for __item in {{ item.name }}:
{{ indent }}    if __item not in {{ item.values_expr }}:
{{ indent }}        raise ValueError("`{{ item.name }}` items must be one of {{ item.values_expr }}")
{% else %}
{{ indent }}if {{ item.name }} not in {{ item.values_expr }}:
{{ indent }}    raise ValueError("`{{ item.name }}` must be one of {{ item.values_expr }}")
{% endif %}
{% endif %}
{% endif %}
{% endfor %}

        request_url = {{ url_expr }}
        query_params: list[tuple[str, Any]] = []
{% for param in query_params %}
{% if param.kind == "from" and param.has_value_map %}
{% if param.is_list %}
        {{ param.temp_list_name }} = {{ param.source_expr }}
        if {{ param.temp_list_name }} in (None, []):
            {{ param.temp_list_name }} = {{ param.default_values_expr if param.default_values_expr is not none else "[]" }}
        elif not isinstance({{ param.temp_list_name }}, list):
            raise TypeError("`{{ param.source_name }}` must be list")
        if {{ param.temp_list_name }} is not None:
            for __item in {{ param.temp_list_name }}:
                if __item not in {{ param.selectable_values_expr }}:
                    raise ValueError("`{{ param.source_name }}` must be one of {{ param.selectable_values_expr }}")
            {{ param.temp_list_name }} = [{{ param.value_map_expr }}[__item] for __item in {{ param.temp_list_name }}]
            if {{ param.temp_list_name }}:
{% if param.list_style_style == "repeat" %}
                query_params.append(({{ param.name_expr }}, {{ param.temp_list_name }}))
{% elif param.list_style_style == "delimited" %}
                query_params.append(({{ param.name_expr }}, {{ param.list_style_delimiter_expr }}.join(str(__item) for __item in {{ param.temp_list_name }})))
{% elif param.list_style_style == "bracket" %}
{% if param.list_style_indexed %}
                for __index, __item in enumerate({{ param.temp_list_name }}):
                    query_params.append(({{ param.name_expr }} + "[{}]".format(__index), __item))
{% else %}
                for __item in {{ param.temp_list_name }}:
                    query_params.append(({{ param.name_expr }} + "[]", __item))
{% endif %}
{% elif param.list_style_style == "json" %}
                query_params.append(({{ param.name_expr }}, json.dumps({{ param.temp_list_name }}, ensure_ascii=False, separators=(",", ":"))))
{% else %}
                query_params.append(({{ param.name_expr }}, {{ param.temp_list_name }}))
{% endif %}
{% else %}
        {{ param.temp_name }} = {{ param.source_expr }}
        if {{ param.temp_name }} is None:
            {% if param.default_value_expr is not none %}
            {{ param.temp_name }} = {{ param.default_value_expr }}
            {% endif %}
        if {{ param.temp_name }} is not None:
            if {{ param.temp_name }} not in {{ param.selectable_values_expr }}:
                raise ValueError("`{{ param.source_name }}` must be one of {{ param.selectable_values_expr }}")
            query_params.append(({{ param.name_expr }}, {{ param.value_map_expr }}[{{ param.temp_name }}]))
{% endif %}
{% elif param.kind == "from" %}
{% if param.is_list %}
        if {{ param.value_expr }}:
{% if param.list_style_style == "repeat" %}
            query_params.append(({{ param.name_expr }}, {{ param.value_expr }}))
{% elif param.list_style_style == "delimited" %}
            query_params.append(({{ param.name_expr }}, {{ param.list_style_delimiter_expr }}.join(str(__item) for __item in {{ param.value_expr }})))
{% elif param.list_style_style == "bracket" %}
{% if param.list_style_indexed %}
            for __index, __item in enumerate({{ param.value_expr }}):
                query_params.append(({{ param.name_expr }} + "[{}]".format(__index), __item))
{% else %}
            for __item in {{ param.value_expr }}:
                query_params.append(({{ param.name_expr }} + "[]", __item))
{% endif %}
{% elif param.list_style_style == "json" %}
            query_params.append(({{ param.name_expr }}, json.dumps({{ param.value_expr }}, ensure_ascii=False, separators=(",", ":"))))
{% else %}
            query_params.append(({{ param.name_expr }}, {{ param.value_expr }}))
{% endif %}
{% else %}
        if {{ param.value_expr }} is not None:
            query_params.append(({{ param.name_expr }}, {{ param.value_expr }}))
{% endif %}
{% elif param.kind == "literal" %}
{% if param.is_list %}
        if {{ param.value_expr }}:
{% if param.list_style_style == "repeat" %}
            query_params.append(({{ param.name_expr }}, {{ param.value_expr }}))
{% elif param.list_style_style == "delimited" %}
            query_params.append(({{ param.name_expr }}, {{ param.list_style_delimiter_expr }}.join(str(__item) for __item in {{ param.value_expr }})))
{% elif param.list_style_style == "bracket" %}
{% if param.list_style_indexed %}
            for __index, __item in enumerate({{ param.value_expr }}):
                query_params.append(({{ param.name_expr }} + "[{}]".format(__index), __item))
{% else %}
            for __item in {{ param.value_expr }}:
                query_params.append(({{ param.name_expr }} + "[]", __item))
{% endif %}
{% elif param.list_style_style == "json" %}
            query_params.append(({{ param.name_expr }}, json.dumps({{ param.value_expr }}, ensure_ascii=False, separators=(",", ":"))))
{% else %}
            query_params.append(({{ param.name_expr }}, {{ param.value_expr }}))
{% endif %}
{% else %}
        query_params.append(({{ param.name_expr }}, {{ param.value_expr }}))
{% endif %}
{% elif param.kind == "input_passthrough" %}
{% if param.is_list %}
        if {{ param.input_name }}:
{% if param.list_style_style == "repeat" %}
            query_params.append(({{ param.name_expr }}, {{ param.input_name }}))
{% elif param.list_style_style == "delimited" %}
            query_params.append(({{ param.name_expr }}, {{ param.list_style_delimiter_expr }}.join(str(__item) for __item in {{ param.input_name }})))
{% elif param.list_style_style == "bracket" %}
{% if param.list_style_indexed %}
            for __index, __item in enumerate({{ param.input_name }}):
                query_params.append(({{ param.name_expr }} + "[{}]".format(__index), __item))
{% else %}
            for __item in {{ param.input_name }}:
                query_params.append(({{ param.name_expr }} + "[]", __item))
{% endif %}
{% elif param.list_style_style == "json" %}
            query_params.append(({{ param.name_expr }}, json.dumps({{ param.input_name }}, ensure_ascii=False, separators=(",", ":"))))
{% else %}
            query_params.append(({{ param.name_expr }}, {{ param.input_name }}))
{% endif %}
{% else %}
        if {{ param.input_name }} is not None:
            query_params.append(({{ param.name_expr }}, {{ param.input_name }}))
{% endif %}
{% endif %}
{% endfor %}
        if query_params:
            request_url += "?" + urlencode(query_params, doseq=True)

{% if transport == "direct" %}
        return await self._parent._direct_request(request_url)
{% elif transport == "goto" %}
        page = await self._parent.ctx.new_page()
{% set has_goto_pipeline = extractor.goto_pipeline_module is not none and extractor.goto_pipeline_function is not none %}
        pipeline_sniffer = None
        try:
{% if has_goto_pipeline %}
            pipeline_sniffer = await self._parent._create_pipeline_sniffer()
{% endif %}
            resp = await page.goto(request_url, wait_until="domcontentloaded")
            if resp is None:
                raise RuntimeError("page.goto() returned None")
            json_override = None
            text_override = None
{% if extractor.render_html %}
            await page.wait_for_load_state("networkidle")
{% endif %}
{% if has_goto_pipeline %}
            warmup = self._parent._make_warmup_context(page=page, sniffer=pipeline_sniffer)
            from {{ root_import_prefix }}{{ extractor.goto_pipeline_module }} import {{ extractor.goto_pipeline_function }} as goto_pipeline_runner
            await goto_pipeline_runner(warmup)
{% endif %}
{% if extractor.script_path_expr %}
            evaluate_script = ({{ extractor.package_root_expr }} / {{ extractor.script_path_expr }}).read_text(encoding="utf-8")
            evaluate_result = await page.evaluate(evaluate_script)
            if isinstance(evaluate_result, dict):
                result_type = str(evaluate_result.get("type", "")).lower()
                if result_type in {"json", "text/json"}:
                    json_override = json.loads(evaluate_result.get("data", "null"))
                elif result_type in {"text", "text/plain"}:
                    text_override = str(evaluate_result.get("data", ""))
{% endif %}
            return await abstraction.Output.from_playwright_response(
                resp,
                page=page,
                json_override=json_override,
                text_override=text_override,
            )
        finally:
            try:
                if pipeline_sniffer is not None:
                    await pipeline_sniffer.complete()
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
            url=request_url,
            json_body=json_body,
{% if request.referrer_expr is not none %}
            referrer={{ request.referrer_expr }},
{% endif %}
{% if request.cors_mode_expr is not none %}
            mode={{ request.cors_mode_expr }},
{% endif %}
{% if request.credentials_expr is not none %}
            credentials={{ request.credentials_expr }},
{% endif %}
{% if request.headers_expr is not none %}
            headers={{ request.headers_expr }},
{% endif %}
        )
{% endif %}
