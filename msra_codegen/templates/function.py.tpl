{% for overload in overloads %}
    @overload
    async def {{ method_name }}(self{% if overload.signature %}{% if signature_kwonly %}, *{% endif %}, {{ overload.signature }}{% endif %}) -> {{ return_annotation }}: ...

{% endfor %}
{% if autotest_enabled %}
    @autotest
{% endif %}
    async def {{ method_name }}(self{% if signature %}{% if signature_kwonly %}, *{% endif %}, {{ signature }}{% endif %}) -> {{ return_annotation }}:
{% if description %}
        """{{ description }}"""
{% endif %}
{% if has_overloads %}
{{ overload_selection_code }}
{{ overload_specialization_code }}
{% if overload_validation_code %}
{{ overload_validation_code }}
{% endif %}
{% else %}
{% for item in validation %}
{% if item.has_checks %}
{% if item.required %}
        if {{ item.name }} is None:
            raise ValueError("`{{ item.name }}` is required")
{% endif %}
{% if item.is_list %}
{% if item.required %}
        if not isinstance({{ item.name }}, list):
            raise TypeError("`{{ item.name }}` must be list")
        for __item in {{ item.name }}:
{% else %}
        if {{ item.name }} is not None and not isinstance({{ item.name }}, list):
            raise TypeError("`{{ item.name }}` must be list")
        if {{ item.name }} is not None:
            for __item in {{ item.name }}:
{% endif %}
{% if "integer" in item.item_type_names %}
{% if item.required %}
            if not isinstance(__item, int) or isinstance(__item, bool):
                raise TypeError("`{{ item.name }}` items must be int")
{% else %}
                if not isinstance(__item, int) or isinstance(__item, bool):
                    raise TypeError("`{{ item.name }}` items must be int")
{% endif %}
{% elif "boolean" in item.item_type_names %}
{% if item.required %}
            if not isinstance(__item, bool):
                raise TypeError("`{{ item.name }}` items must be bool")
{% else %}
                if not isinstance(__item, bool):
                    raise TypeError("`{{ item.name }}` items must be bool")
{% endif %}
{% elif "number" in item.item_type_names %}
{% if item.required %}
            if not isinstance(__item, (int, float)) or isinstance(__item, bool):
                raise TypeError("`{{ item.name }}` items must be number")
{% else %}
                if not isinstance(__item, (int, float)) or isinstance(__item, bool):
                    raise TypeError("`{{ item.name }}` items must be number")
{% endif %}
{% elif "string" in item.item_type_names %}
{% if item.required %}
            if not isinstance(__item, str):
                raise TypeError("`{{ item.name }}` items must be str")
{% else %}
                if not isinstance(__item, str):
                    raise TypeError("`{{ item.name }}` items must be str")
{% endif %}
{% endif %}
{% else %}
{% if "integer" in item.type_names %}
{% if item.required %}
        if not isinstance({{ item.name }}, int) or isinstance({{ item.name }}, bool):
            raise TypeError("`{{ item.name }}` must be int")
{% else %}
        if {{ item.name }} is not None and (not isinstance({{ item.name }}, int) or isinstance({{ item.name }}, bool)):
            raise TypeError("`{{ item.name }}` must be int")
{% endif %}
{% elif "boolean" in item.type_names %}
{% if item.required %}
        if not isinstance({{ item.name }}, bool):
            raise TypeError("`{{ item.name }}` must be bool")
{% else %}
        if {{ item.name }} is not None and not isinstance({{ item.name }}, bool):
            raise TypeError("`{{ item.name }}` must be bool")
{% endif %}
{% elif "number" in item.type_names %}
{% if item.required %}
        if not isinstance({{ item.name }}, (int, float)) or isinstance({{ item.name }}, bool):
            raise TypeError("`{{ item.name }}` must be number")
{% else %}
        if {{ item.name }} is not None and (not isinstance({{ item.name }}, (int, float)) or isinstance({{ item.name }}, bool)):
            raise TypeError("`{{ item.name }}` must be number")
{% endif %}
{% elif "string" in item.type_names %}
{% if item.required %}
        if not isinstance({{ item.name }}, str):
            raise TypeError("`{{ item.name }}` must be str")
{% else %}
        if {{ item.name }} is not None and not isinstance({{ item.name }}, str):
            raise TypeError("`{{ item.name }}` must be str")
{% endif %}
{% endif %}
{% endif %}
{% if item.match_check_expr and not item.is_list %}
{% if item.required %}
        if not ({{ item.match_check_expr }}):
{% else %}
        if {{ item.name }} is not None and not ({{ item.match_check_expr }}):
{% endif %}
{% if item.match_error %}
            raise ValueError({{ item.match_error }})
{% else %}
            raise ValueError("`{{ item.name }}` does not match the expected format")
{% endif %}
{% elif item.match_range and not item.is_list %}
{% if item.required %}
        if float({{ item.name }}) < {{ item.match_range[0] }} or float({{ item.name }}) > {{ item.match_range[1] }}:
            raise ValueError("`{{ item.name }}` must be between {{ item.match_range[0] }} and {{ item.match_range[1] }}")
{% else %}
        if {{ item.name }} is not None and (float({{ item.name }}) < {{ item.match_range[0] }} or float({{ item.name }}) > {{ item.match_range[1] }}):
            raise ValueError("`{{ item.name }}` must be between {{ item.match_range[0] }} and {{ item.match_range[1] }}")
{% endif %}
{% endif %}
{% if item.values_expr %}
{% if item.is_list %}
{% if item.required %}
        for __item in {{ item.name }}:
            if __item not in {{ item.values_expr }}:
                raise ValueError("`{{ item.name }}` items must be one of {{ item.values_expr }}")
{% else %}
        if {{ item.name }} is not None:
            for __item in {{ item.name }}:
                if __item not in {{ item.values_expr }}:
                    raise ValueError("`{{ item.name }}` items must be one of {{ item.values_expr }}")
{% endif %}
{% else %}
{% if item.required %}
        if {{ item.name }} not in {{ item.values_expr }}:
            raise ValueError("`{{ item.name }}` must be one of {{ item.values_expr }}")
{% else %}
        if {{ item.name }} is not None and {{ item.name }} not in {{ item.values_expr }}:
            raise ValueError("`{{ item.name }}` must be one of {{ item.values_expr }}")
{% endif %}
{% endif %}
{% endif %}
{% endif %}
{% endfor %}
{% endif %}

{{ request_url_code }}
        query_params: list[tuple[str, object]] = []
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
            try:
                await goto_pipeline_runner(warmup)
            except MethodPipelineError:
                raise
            except Exception as exc:
                raise MethodPipelineError(str(exc)) from exc
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
