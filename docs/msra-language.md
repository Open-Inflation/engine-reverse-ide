# MSRA Language Reference

Эта страница служит оглавлением и точкой входа в документацию по отдельным таблицам.

## Куда идти сначала

- Формат файла: [\[msra\]](msra-msra.md)
- Базовый пакет и runtime-дефолты: [\[app\]](msra-app.md)
- Стартовый warmup: [\[app.warmup\]](msra-app-warmup.md)
- Общие headers-дефолты: [\[app.defaults.func.headers\]](msra-app-defaults-func-headers.md)
- Переменные окружения: [\[app.variables.<name>\]](msra-app-variables.md)
- Переиспользуемые префиксы: [\[app.prefixes\]](msra-app-prefixes.md)
- Regex-правила: [\[app.regexes.<name>\]](msra-app-regexes.md)
- Группы клиента: [\[app.groups.<path>\]](msra-app-groups.md)
- Функции API: [\[app.func.<id>\]](msra-app-func.md)
- Аргументы функций: [\[app.func.<id>.input.<name>\]](msra-app-func-input.md)
- URL и параметры: [\[app.func.<id>.url\]](msra-app-func-url.md)
- Тело запроса: [\[app.func.<id>.body\]](msra-app-func-body.md)
- Локальные headers функции: [\[app.func.<id>.headers\]](msra-app-func-headers.md)
- Extractor для goto: [\[app.func.<id>.extractor\]](msra-app-func-extractor.md)
- Примеры вызова: [\[app.func.<id>.examples\]](msra-app-func-examples.md)

## Дополнительно

- Семантика quoted/unquoted-путей и identity: [Пути и identity](msra-paths.md)
- Что не отражено в generated Python-коде: [Ограничения генератора](msra-generator-gaps.md)

## Мультифайловость

Основной `.msra` файл можно разбивать на дочерние `.msraf`-фрагменты.
Основной файл подключает фрагмент через `!include("path/to/file.msraf")`, а сам child-файл содержит `!root(".../parent.msra")` только для LSP, чтобы редактор мог корректно резолвить ссылки во время правки.

Пример:

```msra
[app]
name="RootAPI"

[app.func]
!include("funcs.msraf")
```

```msra
!root("./parent.msra")

[GET_USER]
name="get_user"
group=<GROUPS.Catalog>
```

Правила:

- `!include("path/to/file.msraf")` обычно пишется внутри `[app.func]` в основном файле;
- в `.msraf` пишутся только относительные таблицы функций: `[GET_USER]`, `[GET_USER.url]`, `[GET_USER.input.query]`;
- в `.msraf` не нужно писать `app.func` явно, этот префикс добавляется при сборке;
- `!root(...)` нужен для LSP и не попадает в итоговый merged-файл;
- генератор пишет промежуточный `merged.msra`, где все `.msraf` уже вставлены в единый документ без include-ссылок.

## Как читать язык

Удобно воспринимать MSRA как дерево таблиц:

- `[msra]` задаёт версию формата.
- `[app]` задаёт `package_name` и глобальное runtime-поведение.
- Остальные таблицы описывают либо shared-настройки, либо конкретные функции и их runtime-контракт.

Если нужен не обзор, а конкретная схема таблицы, открывай соответствующую страницу выше. Каждая из них описывает один namespace и его поведение отдельно, без смешения с остальными.
