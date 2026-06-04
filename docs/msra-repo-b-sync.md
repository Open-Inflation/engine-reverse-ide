# Схема repo B

На этой странице описана схема для второго репозитория, `repo B`, когда source-ветка содержит MSRA-исходники, а `main` содержит уже сгенерированный Python-артефакт и workflow-файлы.

Ключевая идея:

- `repo B/main` должен содержать generated `source-sync.yml`
- этот workflow запускается вручную через `workflow_dispatch`
- внутри job он сам checkout-ит repo с логикой генератора
- затем читает `repo B/source`, генерирует артефакт и пушит его в `repo B/main`
- при синке сохраняет repo-specific runtime artifacts, перечисленные в `[app.sync].preserved_target_paths` source-MSTRA, например `tests/__snapshots__`
- после `push` в `main` автоматически стартует `publish.yml`

## Почему workflow должен лежать в `main`

GitHub Actions показывает кнопку `Run workflow` только для workflow, который:

- использует `workflow_dispatch`
- присутствует на default branch репозитория

Поэтому ручной trigger для sync должен быть сгенерирован кодогенератором и попасть в `repo B/main`. Нельзя рассчитывать на workflow, который существует только в `source`-ветке.

## Что генерирует кодогенератор

Кодогенератор пишет в target-проект:

- `.github/workflows/source-sync.yml`
- `.github/workflows/tests.yml`
- `.github/workflows/publish.yml`

Именно `source-sync.yml` является первичным ручным trigger’ом для синхронизации.

## Минимальная структура repo B

В `repo B` должны быть:

- ветка `source` с корнем MSRA-исходников
- ветка `main` с результатом генерации
- workflow `.github/workflows/source-sync.yml`, который запускается вручную и сам выполняет sync
- workflow `.github/workflows/publish.yml`, который публикует результат после `push` в `main`
- secret `SOURCE_SYNC_TOKEN`

Тебе не нужно писать собственную логику генерации в `repo B`. Там должен быть только thin orchestration workflow.

### Пример workflow в repo B

```yaml
name: source-sync

on:
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: source-sync-${{ github.repository }}-main
  cancel-in-progress: true

jobs:
  source-sync:
    runs-on: ubuntu-latest

    steps:
      - name: Check out generator repository
        uses: actions/checkout@v4
        with:
          repository: Miskler/engine-reverse-ide
          ref: main
          path: logic
          token: ${{ secrets.SOURCE_SYNC_TOKEN }}
          fetch-depth: 0

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install generator dependencies
        working-directory: logic
        run: |
          python -m pip install --upgrade pip
          python -m pip install -r "msra_codegen/requirements.txt"

      - name: Check out source branch
        uses: actions/checkout@v4
        with:
          repository: ${{ github.repository }}
          ref: source
          path: source
          token: ${{ secrets.SOURCE_SYNC_TOKEN }}
          fetch-depth: 0

      - name: Check out target branch
        uses: actions/checkout@v4
        with:
          repository: ${{ github.repository }}
          ref: main
          path: target
          token: ${{ secrets.SOURCE_SYNC_TOKEN }}
          fetch-depth: 0

      - name: Generate artifact into a staging tree
        working-directory: logic
        run: |
          source_msra_path="path/to/root.msra"
          python -m msra_codegen generate "../source/$source_msra_path" -o ../generated

      - name: Replace target tree contents
        run: |
          python - <<'PY'
          from pathlib import Path
          import shutil

          target = Path("target")
          generated = Path("generated")
          preserved_root = Path("preserved")
          preserve_paths = ["tests/__snapshots__"]

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

          for item in generated.iterdir():
              destination = target / item.name
              if item.is_dir():
                  shutil.copytree(item, destination, dirs_exist_ok=True)
              else:
                  shutil.copy2(item, destination)

          for relative_path in preserve_paths:
              source_path = preserved_root / relative_path
              destination_path = target / relative_path
              if source_path.is_dir():
                  shutil.copytree(source_path, destination_path, dirs_exist_ok=True)
              else:
                  destination_path.parent.mkdir(parents=True, exist_ok=True)
                  shutil.copy2(source_path, destination_path)
          PY

      - name: Validate generated project
        working-directory: logic
        run: |
          python -m msra_codegen validate ../target

      - name: Commit and push
        working-directory: target
        run: |
          git config user.name "msra-sync-bot"
          git config user.email "msra-sync-bot@users.noreply.github.com"
          git add -A
          if git diff --cached --quiet; then
            echo "No generated changes to commit."
            exit 0
          fi
          git commit -m "Regenerate artifact from source"
          git push origin HEAD:main
```

В реальном репозитории этот файл обычно генерируется автоматически. Важна именно форма:

- `workflow_dispatch` сверху
- direct checkout генератора из `repo A`
- чтение `source`-ветки `repo B`
- запись результата в `main`
- установка `target/requirements-dev.txt` перед `validate`, чтобы mypy и ruff видели generated зависимости

## Как проходит один ручной запуск

1. Открой `repo B` в GitHub.
2. Перейди в `Actions`.
3. Выбери workflow `source-sync`.
4. Нажми `Run workflow`.
5. GitHub запустит workflow вручную, потому что в нём есть `workflow_dispatch`.
6. Workflow checkout-ит:
   - `repo A` как источник логики
   - `repo B/source` как входной MSRA-tree
   - `repo B/main` как target-tree
7. Генератор читает корневой `.msra` файл из `repo B/source`.
8. Сгенерированный Python-проект копируется в `repo B/main`.
9. Workflow валидирует результат.
10. Workflow коммитит и пушит изменения в `repo B/main`.
11. После `push` workflow `publish` в `repo B` стартует автоматически.

## Что должно быть настроено в secret

`SOURCE_SYNC_TOKEN` должен уметь:

- читать `repo A`
- читать `repo B/source`
- читать и пушить в `repo B/main`

Если `main` защищён, токен должен иметь право пушить туда, либо sync нужно переделать на создание PR вместо прямого push.

## Что обычно меняется только в repo B

Обычно в `repo B` меняются только эти project-specific вещи:

- путь к корневому `.msra` файлу
- имя source-ветки
- имя target-ветки
- имя secret с токеном

Вся остальная логика берётся из `repo A`, но сам trigger workflow должен жить в `repo B/main`, иначе кнопку `Run workflow` GitHub не покажет.
