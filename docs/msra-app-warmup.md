# [app.warmup]

Таблица `[app.warmup]` описывает внешний Python-скрипт, который запускается во время старта клиента. Warmup выполняется после создания браузера, контекста и страницы, но до того, как клиент начнёт обслуживать вызовы функций.

| Ключ | Что делает | Как влияет на поведение |
| --- | --- | --- |
| `warmup` | Ссылка на Python-функцию вида `./warmup.py:pipeline` | Этот файл копируется в generated package и импортируется как стартовый warmup-скрипт. Функция получает объект `Warmup` с браузером, контекстом, страницей, sniffer-ом, timeout-ом, test-mode и prefixes. |
| `@SniffHeaders` | Включает сбор сетевых заголовков | Запускает `HeaderAnomalySniffer` с `include_subresources=True`, чтобы runtime мог заполнить `UNSTANDARD_HEADERS.*` и `CAPTURED_URLS.*`. |
| `on_error_screenshot_path` | Путь для диагностического скриншота | Назначает `page.on_error_screenshot_path`; если на странице случается ошибка, runtime сохраняет скриншот по этому пути. |
| `timeout_ms` | Локальный таймаут warmup | Переопределяет `app.timeout_ms` только для warmup-кода и всех действий, которые warmup запускает через `warmup.timeout_ms`. |

## Как это работает

- Generated client вызывает warmup внутри `__aenter__`.
- Warmup получает уже созданные `browser`, `context` и `page`.
- Если `@SniffHeaders` не указан, sniffer не стартует.
- Если `warmup` не задан, клиент всё равно поднимает browser context, но без пользовательского warmup-скрипта.

## Примечание по синтаксису

`warmup` задаёт ссылку на внешний Python-скрипт, который получает объект `Warmup` и выполняет стартовую инициализацию клиента.
