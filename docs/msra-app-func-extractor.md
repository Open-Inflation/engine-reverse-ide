# [app.func.<id>.extractor]

Таблица `[app.func.<id>.extractor]` описывает, как извлекать результат из `goto`-функции. Она нужна только для transport=`goto`: для `direct` и `fetch` extractor считается невалидным.

| Ключ | Что делает | Как влияет на поведение |
| --- | --- | --- |
| `@RenderHtml` | Дожидается стабилизации DOM | Перед extraction runtime ждёт `networkidle`, чтобы рендер успел дорисоваться. Это полезно для динамических страниц. |
| `script` | Путь к JS extractor-скрипту | Скрипт читается из package и выполняется в контексте страницы. Он может вернуть JSON или text override. |
| `goto_pipeline` | Путь к Python pipeline-скрипту | После `page.goto()` runtime вызывает этот pipeline с объектом `Warmup`. Это позволяет делать собственную choreography-логику до извлечения результата. |

## `script`

`script` должен быть ссылкой вида `extractors/some-file.js`.

Что он даёт:

- позволяет читать страницу через `page.evaluate`;
- может вернуть `{type: "json", data: ...}` или `{type: "text", data: ...}`;
- даёт возможность подменить результат extraction до сборки `abstraction.Output`.

## `goto_pipeline`

`goto_pipeline` должен быть Python script reference, например `./goto_pipeline.py:pipeline`.

### Что меняется

- package включает этот файл рядом с модулем страницы;
- после `page.goto()` pipeline получает тот же `Warmup` объект, что и обычный warmup;
- если pipeline нужен, runtime поднимает дополнительный sniffer для навигации, чтобы pipeline мог видеть headers и URL-ы запроса.

## Правила

- `script` обязателен для `transport="goto"`.
- `goto_pipeline` опционален.
- Если `transport` не равен `goto`, extractor блок считается ошибкой схемы.
