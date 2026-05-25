# [app.prefixes]

Таблица `[app.prefixes]` хранит повторно используемые строковые константы для URL-частей, origin-ов, base API адресов и других фрагментов, которые нужны в нескольких местах файла.

Каждый ключ становится reference-root вида `DOCUMENT.PREFIXES.<NAME>`.

```msra
[app.prefixes]
MAIN_SITE_URL="https://example.com"
API_BASE="https://api.example.com"
```

Потом эти значения можно использовать так:

```msra
<DOCUMENT.PREFIXES.MAIN_SITE_URL>
<DOCUMENT.PREFIXES.API_BASE>
```

## Что меняется

- Переиспользование `prefixes` убирает дублирование URL-частей.
- Если значение префикса меняется, все ссылки на него меняются автоматически.
- Prefixes особенно полезны для warmup-скриптов, URL base и любых shared reference-цепочек.

