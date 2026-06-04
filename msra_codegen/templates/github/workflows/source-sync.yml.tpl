name: {{ source_sync.name }}

on:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: source-sync-{{ source_sync.repository_expr }}-{{ source_sync.target_branch }}
  cancel-in-progress: true

jobs:
  source-sync:
    runs-on: ubuntu-latest

    steps:
      - name: Check out generator repository
        uses: {{ source_sync.checkout_action }}
        with:
          repository: {{ source_sync.logic_repository | tojson }}
          ref: {{ source_sync.logic_ref | tojson }}
          path: logic
          token: {{ source_sync.repo_token_expr }}
          fetch-depth: 0

      - name: Set up Python
        uses: {{ source_sync.setup_python_action }}
        with:
          python-version: {{ source_sync.python_version | tojson }}

      - name: Install generator dependencies
        working-directory: logic
        run: |
          python -m pip install --upgrade pip
          python -m pip install -r "{{ source_sync.generator_requirements_path }}"

      - name: Check out source branch
        uses: {{ source_sync.checkout_action }}
        with:
          repository: {{ source_sync.repository_expr }}
          ref: {{ source_sync.source_branch | tojson }}
          path: source
          token: {{ source_sync.repo_token_expr }}
          fetch-depth: 0

      - name: Check out target branch
        uses: {{ source_sync.checkout_action }}
        with:
          repository: {{ source_sync.repository_expr }}
          ref: {{ source_sync.target_branch | tojson }}
          path: target
          token: {{ source_sync.repo_token_expr }}
          fetch-depth: 0

      - name: Generate artifact into a staging tree
        working-directory: logic
        run: |
          source_msra_path={{ source_sync.source_msra_path | tojson }}
          python -m msra_codegen generate "../source/$source_msra_path" -o ../generated

      - name: Replace target tree contents
        run: |
          python - <<'PY'
          from pathlib import Path
          import shutil

          target = Path("target")
          generated = Path("generated")

          for child in list(target.iterdir()):
              if child.name == ".git":
                  continue
              if child.is_dir():
                  shutil.rmtree(child)
              else:
                  child.unlink()

          for item in generated.iterdir():
              destination = target / item.name
              if item.is_dir():
                  shutil.copytree(item, destination, dirs_exist_ok=True)
              else:
                  shutil.copy2(item, destination)
          PY

      - name: Install target project dependencies
        working-directory: target
        run: |
          python -m pip install --upgrade pip
          python -m pip install -r requirements-dev.txt

      - name: Validate generated project
        working-directory: logic
        run: |
          python -m msra_codegen validate ../target

      - name: Commit and push
        working-directory: target
        run: |
          git config user.name "{{ source_sync.commit_user_name }}"
          git config user.email "{{ source_sync.commit_user_email }}"
          git add -A
          if git diff --cached --quiet; then
            echo "No generated changes to commit."
            exit 0
          fi
          git commit -m "Regenerate artifact from source"
          git push origin HEAD:{{ source_sync.target_branch }}
