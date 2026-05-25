# [app.func.<id>.body] и nested body tables

Таблица `[app.func.<id>.body]` описывает тело запроса. В ней задаются MIME type, источник payload и дополнительные детали сериализации. Вложенные body-таблицы позволяют описывать multipart-части и nested form/urlencoded-ветки.

| Ключ | Что делает | Как влияет на поведение |
| --- | --- | --- |
| `type` | MIME type body | Определяет, как тело запроса интерпретируется при выполнении и валидации. |
| `charset` | Charset или `null` | Нужен для некоторых body-форматов, особенно когда важна кодировка. |
| `boundary` | Boundary для multipart | Обязателен для `multipart/form-data` и запрещён для non-multipart body. |
| `return_name` | Сохранять имя части | Полезно для multipart/file-like payload-ов, где важно не потерять имя part-а. |
| `filename` | Имя файла в payload | Используется для file-like частей и загрузок. |
| `from` | Источник payload | Само тело или выражение, которое нужно сериализовать в запрос. |

## `type`

Поддерживаются browser-supported MIME type-значения, например:

- `application/json`
- `application/x-www-form-urlencoded`
- `multipart/form-data`
- `text/html`

### Что меняется

- `type` определяет, какие дополнительные правила body становятся обязательными.
- `multipart/form-data` включает строгую проверку `boundary`.
- `application/x-www-form-urlencoded` допускает nested `url`-ветку внутри body.

## Правила body

- Если `type="multipart/form-data"`, `boundary` обязателен.
- Если `type` не multipart, `boundary` запрещён.
- Если `type` не multipart и нет `from`, body должен иметь nested `url`-ветку только для form-urlencoded сценария.
- Nested body tables допускаются только под multipart-родителем.

## Nested body item tables

`[app.func.<id>.body.<name>]` описывает отдельный body-item.

У такого item-а тот же набор ключей:

- `type`
- `charset`
- `boundary`
- `return_name`
- `filename`
- `from`

### Что меняется

- Multipart-сценарии могут описывать несколько частей, а не один плоский payload.
- Если у nested item есть собственный `url`-child, это уже вложенная URL-ветка внутри body.
- Если родитель body-item не multipart, nested-ветка считается ошибкой.

## `[app.func.<id>.body.<name>.url]`

У body-item-а может быть вложенный `url`-namespace.

Это используется, когда body строится как nested urlencoded/form-like структура.

### Правила пути

- `url` становится системным сегментом только после хотя бы одного body-item-а.
- Если нужен literal body item с именем `url`, его надо писать в кавычках.
- До появления body-item-а использовать `url` как child запрещено.
