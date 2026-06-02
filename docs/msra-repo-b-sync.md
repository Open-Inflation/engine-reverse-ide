# Схема repo B

На этой странице описана схема для второго репозитория, `repo B`, когда этот репозиторий является источником правды для логики генерации.

Разделение ролей такое:

- `repo A` = логика генератора и reusable workflow
- `repo B/source` = исходники MSRA
- `repo B/main` = сгенерированный Python-артефакт, документация и workflow-файлы

## Что ручное, а что автоматическое

Запуск sync в `repo B` ручной.

- Ты открываешь `Actions` в `repo B` и нажимаешь `Run workflow` у workflow `source-sync`.
- Этот workflow использует `workflow_dispatch`, поэтому он не реагирует на `push`.
- После того как sync закоммитит изменения в `repo B/main`, workflow `publish` в `repo B` стартует автоматически на `push` в `main`.

Ключевой момент:

- `workflow_dispatch` отвечает только за старт процесса.
- `source` и `main` задаются как рабочие ветки в конфиге, а не вводятся руками при каждом запуске.

## Минимальная структура repo B

В `repo B` должны быть:

- ветка `source` с корнем MSRA-исходников
- ветка `main` с результатом генерации
- workflow `.github/workflows/source-sync.yml`, который только вызывает reusable workflow из этого репозитория
- workflow `.github/workflows/publish.yml`, который публикует результат после `push` в `main`
- secret `SOURCE_SYNC_TOKEN`

Тебе не нужно писать в `repo B` собственную логику генерации. Там должен быть только thin-wrapper.

### Пример thin-wrapper

```yaml
name: source-sync

on:
  workflow_dispatch:

jobs:
  source-sync:
    uses: Miskler/engine-reverse-ide/.github/workflows/source-sync.yml@main
    with:
      logic_repository: Miskler/engine-reverse-ide
      logic_ref: main
      source_repository: ${{ github.repository }}
      source_ref: source
      source_msra_path: path/to/root.msra
      target_repository: ${{ github.repository }}
      target_ref: main
      generator_python_version: "3.12"
      generator_requirements_path: "msra_codegen/requirements.txt"
      commit_user_name: "msra-sync-bot"
      commit_user_email: "msra-sync-bot@users.noreply.github.com"
    secrets:
      repo_token: ${{ secrets.SOURCE_SYNC_TOKEN }}
```

В реальном репозитории этот файл обычно генерируется автоматически. Тебе важно сохранить саму форму: `workflow_dispatch` сверху и reusable workflow из `repo A` в `jobs.source-sync.uses`.

## Как проходит один ручной запуск

1. Открой `repo B` в GitHub.
2. Перейди в `Actions`.
3. Выбери workflow `source-sync`.
4. Нажми `Run workflow`.
5. GitHub запустит workflow вручную, потому что в нём есть `workflow_dispatch`.
6. Сам caller-workflow только вызывает reusable workflow из `repo A`.
7. Reusable workflow делает checkout:
   - `repo A` как источник логики
   - `repo B/source` как входной MSRA-tree
   - `repo B/main` как target-tree
8. Генератор читает корневой `.msra` файл из `repo B/source`.
9. Сгенерированный Python-проект копируется в `repo B/main`.
10. Reusable workflow валидирует результат.
11. Reusable workflow коммитит и пушит изменения в `repo B/main`.
12. После push workflow `publish` в `repo B` стартует автоматически.

## Где должен лежать workflow-файл

GitHub показывает кнопку `Run workflow` только для workflow, который:

- использует `workflow_dispatch`
- присутствует на default branch репозитория

Практически для этой схемы это означает следующее:

- default branch `repo B` должен быть `main`
- workflow `.github/workflows/source-sync.yml` должен быть закоммичен в `main`
- сам sync при этом всё равно читает `source` и пишет в `main`

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

Вся остальная логика берётся из reusable workflow в `repo A`.
