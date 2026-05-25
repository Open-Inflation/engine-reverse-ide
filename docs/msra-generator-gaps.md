# Ограничения генератора

Эта страница фиксирует ограничения codegen на примере `examples/example.msra`.
Она описывает то, что не отражено в сгенерированном Python-коде.

## 1. Вложенные `url.params.*` ниже прямого уровня не попадают в генерацию

В `examples/example.msra` есть вложенный параметр:

```msra
[app.func.A3A417.url.params.from_global.params.text]
from=<INPUT.query>
match=<DOCUMENT.REGEXES.TEXT_REQUEST>
```

Генератор собирает только таблицы прямого уровня `app.func.<id>.url.params`.
Более глубокая ветка `params.text` проходит анализ и валидацию, но в Python-выход не попадает.

Что это значит на практике:

- `query` проверяется как input;
- но в сгенерированном `feed()` он не превращается в часть `request_url`;
- nested `params.text` фактически теряется на этапе codegen.

## 2. `body` учитывается только частично

В `examples/example.msra` у body есть не только `type` и `from`, но и:

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
from={"key": <VARIABLES.city_id>, "key3": <INPUT.query>}
```

Генератор берет из body только `type` и `from`, а шаблон функции сводит это к `json_body = ...`.
Из-за этого:

- `multipart/form-data` не получает полноценного кода сборки multipart;
- `application/x-www-form-urlencoded` не получает отдельной генерации формы;
- `charset`, `boundary`, `return_name`, `filename` не отражаются в output;
- nested body/url-ветки в codegen не превращаются в отдельную логику запроса.

## 3. `app.regexes.*.actions` не генерируются

В `examples/example.msra` regex-правило описано не только через `regex` и `raise`, но и через цепочку действий:

```msra
[app.regexes.TEXT_REQUEST]
regex="^[a-zа-яё+]+$"
actions=[
    {action=lower}
    {"action"=replace, what=" ", with="+"}
]
raise="Текст запроса должен состоять только из букв и знаков + между ними (вместо пробелов)"
```

В Python-выходе для regex остаются `REGEX` и `ERROR`.

## 4. `app.func.*.examples` не превращаются в generated tests or fixtures

В `examples/example.msra` у функции есть примеры:

```msra
[app.func.A3A417.examples.smoke]
@Test
@Docs
inputs={"query"="example"}

[app.func.A3A417.examples.alt_query]
@Docs
inputs={"query"="example2"}
```

Codegen не добавляет в Python-пакет:

- fixtures для этих примеров;
- generated contract tests;
- отдельную runtime-логику, которая бы использовала `@Test`.

## 5. `FUNCRESULT`-ссылки поддержаны только в LSP-контексте примеров

Планируемый синтаксис вида:

```msra
<FUNCRESULT.A3A417.JSON["some"]["path"][0]>
```

поддерживается LSP как специальный reference-синтаксис.

Важно именно это ограничение:

- codegen не умеет генерировать runtime-логику для `FUNCRESULT`;
- LSP принимает такую ссылку только внутри `[app.func.*.examples.<name>]` в значениях `inputs.<key>.value`;
- синтаксис должен содержать result-kind сегмент `JSON`, `TEXT` или `IMAGE`, то есть `<FUNCRESULT.<function>.JSON|TEXT|IMAGE>`;
- если выбран `JSON`, после него можно продолжать путь к конкретным элементам через `["..."]` и `[0]`;
- вне этого блока ссылка считается ошибочной.

## 6. `@SubUrl` принят схемой, но не меняет URL-сериализацию в Python output

В `url.params` аннотация `@SubUrl` валидируется парсером и анализатором, но generated Python не использует её как отдельную ветку сериализации.

Это значит, что:

- аннотация остаётся частью контрактной модели;
- tooling может показывать её как семантический маркер;
- generated client не делает из неё отдельное runtime-поведение.

## 7. `merged.msra` — это нормализованный промежуточный файл, а не source-preserving round-trip

Генератор пишет `merged.msra` как технический артефакт для проверки и последующей генерации. Он собирает таблицы в порядке сортировки по path и сериализует только структуру таблиц и assignment-ов.

Из-за этого в merged-файле не сохраняются:

- комментарии;
- исходные пустые строки и форматирование;
- `!include` / `!root` directives;
- исходный порядок таблиц из отдельных файлов.

Это не ошибка codegen, а его нормализующий режим вывода: `merged.msra` удобен как промежуточная точка проверки, но не как вербатим-копия исходников.

## 8. Helper-скрипты копируются только по прямым путям из source tree

Codegen копирует только те файлы, которые напрямую указаны в `app.warmup.warmup`, `app.func.*.extractor.script` и `app.func.*.extractor.goto_pipeline`.

Важно помнить:

- путь берётся относительно каталога исходного `.msra` файла;
- если файл отсутствует в source tree, генерация падает с ошибкой чтения;
- generator не анализирует и не упаковывает транзитивные импорты или дополнительные helper-файлы, на которые ссылаются эти скрипты.

## Что важно помнить

Эта страница помогает держать отдельно семантику MSRA как языка и то, что отражено в generated Python-коде.
