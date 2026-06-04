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
          from fnmatch import fnmatch
          from pathlib import Path
          import shutil

          target = Path("target")
          generated = Path("generated")
          preserved_root = Path("preserved")
          preserve_paths = {{ source_sync.preserved_target_paths | tojson }}
          ignored_patterns = {{ source_sync.ignored_generated_patterns | tojson }}

          def is_ignored(relative_path: Path) -> bool:
              relative_text = relative_path.as_posix()
              return any(fnmatch(relative_text, pattern) for pattern in ignored_patterns)

          def copy_tree(source_root: Path, destination_root: Path) -> None:
              for item in source_root.iterdir():
                  relative_path = item.relative_to(source_root)
                  if is_ignored(relative_path):
                      continue
                  destination_path = destination_root / relative_path
                  if item.is_dir():
                      destination_path.mkdir(parents=True, exist_ok=True)
                      copy_tree(item, destination_path)
                  else:
                      destination_path.parent.mkdir(parents=True, exist_ok=True)
                      shutil.copy2(item, destination_path)

          def remove_ignored(root: Path) -> None:
              ignored_paths = sorted(
                  [path for path in root.rglob("*") if is_ignored(path.relative_to(root))],
                  key=lambda path: len(path.parts),
                  reverse=True,
              )
              for path in ignored_paths:
                  if path.is_dir():
                      shutil.rmtree(path)
                  else:
                      path.unlink()

          for relative_path in preserve_paths:
              source_path = target / relative_path
              if not source_path.exists():
                  raise RuntimeError(f'Preserved target path "{relative_path}" does not exist.')
              destination_path = preserved_root / relative_path
              destination_path.parent.mkdir(parents=True, exist_ok=True)
              if source_path.is_dir():
                  shutil.copytree(source_path, destination_path)
              else:
                  shutil.copy2(source_path, destination_path)

          for child in list(target.iterdir()):
              if child.name == ".git":
                  continue
              if child.is_dir():
                  shutil.rmtree(child)
              else:
                  child.unlink()

          copy_tree(generated, target)

          for relative_path in preserve_paths:
              source_path = preserved_root / relative_path
              destination_path = target / relative_path
              if source_path.is_dir():
                  shutil.copytree(source_path, destination_path, dirs_exist_ok=True)
              else:
                  destination_path.parent.mkdir(parents=True, exist_ok=True)
                  shutil.copy2(source_path, destination_path)

          remove_ignored(target)
          shutil.rmtree(preserved_root, ignore_errors=True)
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
