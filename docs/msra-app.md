# [app]

Таблица `[app]` описывает само приложение или API-пакет, который будет сгенерирован из MSRA-файла. Здесь живут метаданные пакета и глобальные настройки runtime, которые влияют на старт браузера и на поведение всех функций.

| Ключ | Что делает | Как влияет на поведение |
| --- | --- | --- |
| `name` | Публичное имя приложения | Используется в заголовках документации и в docstring-ах сгенерированного клиента. Имя должно быть без пробелов. |
| `package_name` | Имя Python-пакета | Единственный источник имени сгенерированного пакета и папки output. Значение должно быть статическим и в формате `lowercase_snake_case`, например `fixprice_api`. |
| `package_owner` | GitHub owner или organization | Используется для ссылок и бейджей в `README.md`, включая GitHub repo URL, GitHub Pages docs URL и GitHub Actions badges. Значение должно быть статическим и соответствовать имени owner/organization на GitHub. |
| `social` | Ссылки на соцсети | Inline table со статическими ссылками для README-бейджей, например `social={telegram="https://t.me/...", discord="https://discord.gg/..."}`. |
| `authors` | Список авторов | Попадает в package metadata. Каждый элемент содержит `name` и `email`. |
| `logo` | Логотип проекта | Локальный путь к монохромному растровому файлу относительно MSRA-файла, например `./path.png`. Генератор копирует его в `docs/source/_static/` как `logo-light.webp` и `logo-dark.webp` и автоматически создаёт инверсионную пару для тёмной темы docs. Если в изображении есть цветные пиксели, генерация завершается runtime error. |
| `description` | Краткое описание проекта | Используется в документации, в README и в метаданных сгенерированного пакета. |
| `license` | Идентификатор лицензии | Попадает в package metadata и рендерится из локального шаблона в `msra_codegen/templates/licenses/` в корневой `LICENSE` сгенерированного проекта. |
| `keywords` | Список ключевых слов | Попадает в `project.keywords` в `pyproject.toml` и помогает классифицировать пакет на PyPI. |
| `min_required_python` | Минимально поддерживаемая версия Python | Попадает в `requires-python` и используется для генерации Python version classifiers в `pyproject.toml`. Верхняя граница classifiers определяется по официальному `python.org/api/v2/downloads/release/`: генератор берёт предпоследний стабильный `3.x` family и включает его полностью. |
| `version` | Версия клиента или API-контракта | Копируется в generated package и используется как версия артефакта. Значение должно быть статическим. |
| `timeout_ms` | Глобальный таймаут по умолчанию | Становится базовым лимитом для runtime-операций и используется, если локальный блок не переопределяет timeout. |
| `browser` | Браузер по умолчанию | Определяет, какой движок запустит runtime для warmup и browser-backed функций. Если не указан, runtime использует `camoufox` по умолчанию. |
| `@DisallowHeadless` | Запрещает headless-запуск | Меняет дефолт `headless` на `False`, заставляет runtime выбрасывать ошибку, если caller всё же просит `headless=True`, и переключает generated test pipeline на headed запуск под `xvfb-run` с установкой Xvfb из `github.workflows.tests.xvfb_install_commands` (runner должен уметь выполнить эти команды). |
| `@Humanize` | Включает humanized-режим браузера | Передаёт `humanize=` в `AsyncCamoufox`, снижает “ботоподобность” поведения и требует `browser="camoufox"`. Разрешена либо как пустая аннотация, либо с положительным числом интенсивности, например `@Humanize(0.5)`. |
| `@BlockImages` | Блокирует загрузку изображений | Передаёт `block_images=` в `AsyncCamoufox`, ускоряет старт и экономит трафик. Аннотация работает только с `browser="camoufox"`. |

## `authors`

Каждый автор описывается объектом:

| Ключ | Что делает |
| --- | --- |
| `name` | Имя автора |
| `email` | Email автора |

## `browser`

Допустимые значения:

- `chromium`
- `firefox`
- `webkit`
- `camoufox`

### Что меняется

- `browser` определяет движок, на котором запускаются warmup и browser-backed функции.
- `@DisallowHeadless` меняет значение по умолчанию для `headless` на `False`, запрещает запуск с `headless=True` и переключает generated test workflow на headed запуск под `xvfb-run`.
- `@Humanize` и `@BlockImages` валидны только при `browser="camoufox"`.
- Если значение не задано, runtime и generated client используют `camoufox` как дефолтный режим.
- `package_name` задаёт имя generated Python-пакета; generator больше не пытается выводить его из `name`.
- `package_owner` задаёт GitHub owner/organization, из которого собираются ссылки и бейджи в generated `README.md`.
- `social` задаёт внешние ссылки для README-бейджей, сейчас поддерживаются ключи `telegram` и `discord`.
- `logo` задаёт локальный монохромный растровый файл логотипа; generator копирует его в `docs/source/_static/` как `logo-light.webp` и `logo-dark.webp`, автоматически определяет, был ли входной образец black или white, и рендерит светлую и тёмную версии для docs/Furo sidebar. Цветные пиксели вызывают runtime error сборки.
- `description` попадает в `pyproject.toml` и выводится отдельной строкой в generated `README.md`, если оно не пустое.
- `license` используется и для `pyproject.toml`, и для корневого `LICENSE` в сгенерированном проекте; текст лицензии берётся только из локального шаблона в `msra_codegen/templates/licenses/`.
- runtime dependencies генерируются по содержимому проекта: базово это `camoufox[geoip]`, `human_requests`, `Pillow`, `rich`, а при наличии хотя бы одной функции с `transport=direct` генератор добавляет `aiohttp` и `aiohttp-retry`. Тот же список пишется в `pyproject.toml` и в root `requirements.txt`.
- `keywords` попадает в `project.keywords` без дополнительной трансформации.
- `min_required_python` задаёт нижнюю границу `requires-python`; generator также расширяет его в Python version classifiers, поднимая верхнюю границу по официальному `python.org/api/v2/downloads/release/` и беря предпоследний стабильный `3.x` family как включительный предел.
- Для шаблонов, где это нужно, generator подставляет значения вроде текущего года и списка copyright holders из `authors`.

## Аннотации

`@Humanize` включает humanized-режим браузера и принимает пустую форму или положительное число интенсивности, например `@Humanize(0.5)`.
`@BlockImages` блокирует загрузку изображений при старте браузера.
`@DisallowHeadless` делает `headless=False` значением по умолчанию и выбрасывает runtime error, если клиент всё же стартует с `headless=True`.

`@Humanize` и `@BlockImages` работают только с `browser="camoufox"`. `@DisallowHeadless` не зависит от выбранного браузера, но влияет на generated CI pipeline, который начинает запускать браузерные тесты через `xvfb-run` и установку Xvfb.
