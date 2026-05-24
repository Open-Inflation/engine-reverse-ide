{% macro render_pipeline_steps(steps, indent, page_ref, sniffer_ref=None, test_mode_ref=None) %}
{% for step in steps %}
{{ render_pipeline_step(step, indent, page_ref, sniffer_ref, test_mode_ref) }}
{% endfor %}
{% endmacro %}

{% macro render_pipeline_step(step, indent, page_ref, sniffer_ref=None, test_mode_ref=None) %}
{% if step.kind == "test_block" %}
{% if test_mode_ref %}
{{ indent }}if {{ test_mode_ref }}:
{{ render_pipeline_steps(step.steps, indent + "    ", page_ref, sniffer_ref, none) }}
{% else %}
{{ render_pipeline_steps(step.steps, indent, page_ref, sniffer_ref, test_mode_ref) }}
{% endif %}
{% elif step.for_tests and test_mode_ref %}
{{ indent }}if {{ test_mode_ref }}:
{{ render_pipeline_step(step, indent + "    ", page_ref, sniffer_ref, None) }}
{% else %}
{% if step.action == "wait_network" %}
{{ indent }}await {{ page_ref }}.wait_for_load_state({{ step.state_expr }})
{% elif step.action == "wait_element" %}
{{ indent }}await {{ page_ref }}.wait_for_selector(
{{ indent }}    selector={{ step.what_expr }}, timeout=self.timeout_ms, state={{ step.state_expr }}
{{ indent }})
{% if step.then == "click" %}
{{ indent }}locator = {{ page_ref }}.locator({{ step.what_expr }}).first
{{ indent }}await locator.click(timeout=self.timeout_ms)
{% endif %}
{% elif step.action == "wait_sniffer" and sniffer_ref %}
{{ indent }}await {{ sniffer_ref }}.wait(
{{ indent }}    tasks=[
{{ indent }}        WaitHeader(
{{ indent }}            source={{ step.sniffer_source_expr }},
{{ indent }}            headers={{ step.sniffer_headers_expr }},
{{ indent }}        )
{{ indent }}    ],
{{ indent }}    timeout_ms=self.timeout_ms,
{{ indent }})
{% elif step.action == "click" %}
{{ indent }}await {{ page_ref }}.locator({{ step.what_expr }}).first.click(timeout=self.timeout_ms)
{% elif step.action == "always" and step.then_step %}
{{ render_pipeline_step(step.then_step, indent, page_ref, sniffer_ref, test_mode_ref) }}
{% else %}
{{ indent }}# Unhandled pipeline action: {{ step.action }}
{% endif %}
{% endif %}
{% endmacro %}
