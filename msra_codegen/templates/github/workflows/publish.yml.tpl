name: {{ publish.name }}

on:
  push:
    branches:
      - {{ publish.branch }}
  workflow_dispatch:
    inputs:
      target:
        description: "Publish target"
        required: true
        default: "all"
        type: choice
        options: {{ publish.target_options | tojson }}

permissions:
  contents: write
  issues: write
  pull-requests: write
  pages: write
  id-token: write   # нужно для PyPI Trusted Publishing (OIDC)

concurrency:
  group: {{ publish.concurrency_group }}
  cancel-in-progress: true

jobs:
  tests:
    name: Run tests (reusable)
    uses: {{ publish.workflow_tests_path }}
    with:
      python-version: {{ publish.python_version | tojson }}

  build-docs:
    if: {{ publish.docs_condition_expr }}
    name: Build docs
    needs: tests
    runs-on: ubuntu-latest
    steps:
      - uses: {{ publish.checkout_action }}
      - uses: {{ publish.setup_python_action }}
        with:
          python-version: {{ publish.python_version | tojson }}

      - name: Install deps (venv)
        run: |
          python -m venv venv
          venv/bin/python -m pip install --upgrade pip
          venv/bin/python -m pip install -r requirements.txt
          venv/bin/python -m pip install -r docs/requirements.txt
          PATH="$PWD/venv/bin:$PATH" make install-dev

      - name: Build docs (venv)
        run: |
          PATH="$PWD/venv/bin:$PATH" make docs

      - name: Upload Pages artifact
        uses: {{ publish.upload_pages_action }}
        with:
          path: docs/_build/html

  deploy-docs:
    if: {{ publish.docs_condition_expr }}
    name: Deploy docs to GitHub Pages
    needs: build-docs
    runs-on: ubuntu-latest
    environment:
      name: {{ publish.pages_environment_name }}
      url: {{ publish.page_url_expr }}
    steps:
      - name: Deploy
        id: deployment
        uses: {{ publish.deploy_pages_action }}

  pypi:
    if: {{ publish.package_condition_expr }}
    name: Build & publish to PyPI (Trusted Publishing)
    needs: tests
    runs-on: ubuntu-latest
    environment:
      name: {{ publish.pypi_environment_name }}
      url: {{ publish.pypi_url }}
    steps:
      - uses: {{ publish.checkout_action }}
      - uses: {{ publish.setup_python_action }}
        with:
          python-version: {{ publish.python_version | tojson }}
          cache: {{ publish.setup_python_cache }}

      - name: Build artifacts (PEP 517) (venv)
        run: |
          python -m venv venv
          venv/bin/python -m pip install --upgrade pip
          venv/bin/python -m pip install build
          PATH="$PWD/venv/bin:$PATH" make build

      - name: Publish to PyPI via OIDC
        uses: {{ publish.pypi_action }}
        with:
          verbose: true
