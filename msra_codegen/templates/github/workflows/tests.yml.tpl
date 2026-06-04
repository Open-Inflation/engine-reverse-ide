name: {{ tests.name }}

on:
  pull_request:
  schedule:
    - cron: "{{ tests.schedule_cron }}"  # daily at 03:17 UTC
  workflow_dispatch:
  workflow_call:
    inputs:
      python-version:
        required: false
        type: string
        default: "{{ tests.python_version }}"

permissions:
  contents: write
  issues: write
  pull-requests: write

concurrency:
  group: {{ tests.concurrency_group }}
  cancel-in-progress: true

jobs:
  tests:
    runs-on: {{ tests.runner | tojson }}

    steps:
      - name: Check out repository
        uses: {{ tests.checkout_action }}

      - name: Set up Python
        uses: {{ tests.setup_python_action }}
        with:
          python-version: {{ tests.python_version_expr }}

      - name: Install project (venv)
        run: |
{% for line in tests.install_commands %}
          {{ line }}
{% endfor %}

{% if tests.requires_xvfb %}
      - name: Install Xvfb
        run: |
{% for line in tests.xvfb_install_commands %}
          {{ line }}
{% endfor %}

{% endif %}

      - name: Run tests (venv)
        env:
          MSRA_RUN_COMMANDS: |
{% for line in tests.run_commands %}
            {{ line }}
{% endfor %}
        run: |
{% if tests.requires_xvfb %}
          {{ tests.headed_run_command_shell }} "$MSRA_RUN_COMMANDS"
{% else %}
          {{ tests.run_command_shell }} "$MSRA_RUN_COMMANDS"
{% endif %}

      - name: report playwright failure
        if: failure()
        uses: {{ tests.report_playwright_failure_action }}
        with:
          github_token: {{ tests.github_token_expr }}
          log_path: {{ tests.log_path }}
          screenshot_path: {{ tests.screenshot_path }}

      - name: auto PR schema
      # отмена джобы исключается (поэтому и не always)
        if: success() || failure()
        uses: {{ tests.report_schema_action }}
        with:
          github_token: {{ tests.github_token_expr }}
