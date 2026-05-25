# [app.func.<id>.headers]

Таблица `[app.func.<id>.headers]` задаёт локальные request-policy overrides для одной конкретной функции. Она имеет ту же форму, что и `[app.defaults.func.headers]`, но применяется только к одному endpoint-у.

| Ключ | Что делает | Как влияет на поведение |
| --- | --- | --- |
| `referrer` | Локальный referrer | Переопределяет глобальный default для одной функции. |
| `cors_mode` | Локальный CORS mode | Переопределяет `cors_mode` из `[app.defaults.func.headers]`. |
| `credentials` | Локальный credentials policy | Переопределяет `credentials` из `[app.defaults.func.headers]`. |
| `headers` | Локальные HTTP headers | Перекрывает или дополняет набор заголовков для конкретной функции. |

## Как это работает

- Если локальный ключ задан, он выигрывает у глобального дефолта.
- Если локальный ключ не задан, generated client берёт значение из `[app.defaults.func.headers]`.
- Если ни там, ни там ничего не задано, runtime использует встроенные client defaults.

