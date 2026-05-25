# [app.defaults.func.headers]

Таблица `[app.defaults.func.headers]` задаёт общие request-policy defaults для всех функций. Это базовый слой заголовков и fetch-политики, который применяется, если конкретная функция не переопределяет значения локально.

| Ключ | Что делает | Как влияет на поведение |
| --- | --- | --- |
| `referrer` | Значение `Referrer`/`Referer` | Становится дефолтным referrer для всех browser-backed запросов. Если значение не задано, generated client подставляет origin основного сайта. |
| `cors_mode` | Режим CORS | Управляет `mode=` у browser fetch. Допустимы `cors`, `no-cors`, `same-origin`. |
| `credentials` | Credentials policy | Управляет тем, отправляются ли cookies и авторизационные данные. Допустимы `omit`, `same-origin`, `include`. |
| `headers` | Дополнительные HTTP-заголовки | Формирует базовый набор request headers, который client передаёт в `_request`. Если блок не задан, runtime использует встроенный `Accept: application/json, text/plain, */*`. |

## Как это влияет на функции

- Эти значения являются глобальным fallback-слоем для всех `app.func.<id>`.
- `[app.func.<id>.headers]` может переопределить любой из этих ключей для одной конкретной функции.
- Если и глобальный, и локальный блок не задают значение, generated client использует свои встроенные дефолты.

