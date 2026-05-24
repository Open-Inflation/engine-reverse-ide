# Ограничения генератора

Эта страница фиксирует текущие ограничения codegen на примере `example.msra`.
Она не описывает желаемое поведение, а только то, что сейчас еще не отражено в сгенерированном Python-коде.

## 1. Вложенные `url.params.*` ниже прямого уровня не попадают в генерацию

В `example.msra` есть вложенный параметр:

```msra
[app.func.A3A417.url.params.from_global.params.text]
data=<INPUT.query>
revalue=<DOCUMENT.REGEXES.TEXT_REQUEST>
```

Сейчас генератор собирает только таблицы прямого уровня `app.func.<id>.url.params`.
Более глубокая ветка `params.text` проходит анализ и валидацию, но в Python-выход не попадает.

Что это значит на практике:

- `query` проверяется как input;
- но в сгенерированном `feed()` он не превращается в часть `request_url`;
- nested `params.text` фактически теряется на этапе codegen.

## 2. `body` учитывается только частично

В `example.msra` у body есть не только `type` и `data`, но и:

- `charset`
- `boundary`
- `return_name`
- `filename`
- вложенные таблицы вроде `body.ANYNAME`
- вложенные body-item таблицы вроде `body.VLOJENNOST.ANYNAME3.url`

Примеры:

```msra
[app.func.A3A417.body]
type="multipart/form-data"
charset=null
boundary="abc"
```

```msra
[app.func.A3A417.body.ANYNAME]
type="application/json"
return_name=true
data={"key": <VARIABLES.city_id>, "key3": <INPUT.query>}
```

Сейчас генератор берет из body только `type` и `data`, а шаблон функции сводит это к `json_body = ...`.
Из-за этого:

- `multipart/form-data` не получает полноценного кода сборки multipart;
- `application/x-www-form-urlencoded` не получает отдельной генерации формы;
- `charset`, `boundary`, `return_name`, `filename` не отражаются в output;
- nested body/url-ветки в codegen не превращаются в отдельную логику запроса.

## 3. `app.regexes.*.actions` не генерируются

В `example.msra` regex-правило описано не только через `regex` и `raise`, но и через цепочку действий:

```msra
[app.regexes.TEXT_REQUEST]
regex="^[a-zа-яё+]+$"
actions=[
    {action=lower}
    {"action"=replace, what=" ", with="+"}
]
raise="Текст запроса должен состоять только из букв и знаков + между ними (вместо пробелов)"
```

Сейчас в Python-выходе для regex остается только:

- `REGEX`
- `ERROR`

То есть сами действия нормализации строки до проверки не переносятся в сгенерированный код.

## 4. `warmup.humanize_action` не протаскивается в runtime

В `example.msra` warmup описан так:

```msra
[app.warmup]
humanize=true
humanize_action={from=1000, to=3000}
block_images=true
```

Сейчас генератор и шаблон используют `humanize`, `block_images`, `url`, `headers_sniffer`, `on_error_screenshot_path` и `pipeline`,
но отдельный диапазон `humanize_action` в generated Python не сохраняется.

Итог:

- режим humanize включается;
- но точная задержка действий из `humanize_action` теряется.

## 5. `app.func.*.examples` не превращаются в generated tests or fixtures

В `example.msra` у функции есть примеры:

```msra
[app.func.A3A417.examples]
examples=[{"inputs"={"query"="example"}, "test"=false, "file"="local1.json"}, {"file"="local2.json"}]
test=true
```

Сейчас это полезно для валидации и анализа контракта, но в Python-пакет codegen не добавляет:

- fixtures для этих примеров;
- generated contract tests;
- отдельную runtime-логику, которая бы использовала `test=true`.

То есть `examples` остаются частью описания API, но не превращаются в код, который можно запустить как часть generated package.

## Что важно помнить

Эта страница нужна, чтобы не смешивать два разных уровня:

- семантику MSRA как языка;
- и то, что уже умеет текущий генератор.

Если какой-то пункт из этой страницы будет реализован, лучше сразу обновлять и документацию, и соответствующие тесты, чтобы пример `example.msra` не расходился с generated code молча.
