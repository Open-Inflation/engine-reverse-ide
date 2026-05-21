
Стандартный язык TOML с объектными вставками вида `<OBJECT>` или `<OBJECT.value>`

Доступные OBJECTS:
1. CAPTURED_HEADERS (.RESPONSE или .REQUEST -> {key: value})
2. CAPTURED_URLS (.RESPONSE или .REQUEST -> array)
3. COOKIES (например COOKIES["key"].VALUE["data"] <- при этом нужно быть уверенным что строку возможно представить как словарь). Так же доступно DOMAIN, PATH, EXPIRES, HTTP_ONLY, SECURE, SAME_SITE
4. LOCAL_STORAGE
5. SESSION_STORAGE
* оба метода дополняются исключительно сниффером при warmup

3. INPUT -> any data
4. VARIABLES (.any_key) -> any data   
5. DOCUMENT (.PREFIXES или .REGEX) -> any data (позволяет получить доступ к другим переменным в toml)

Доступны фильтры вида CAPTURED_URLS(START="http",TYPE=STR,END="something")

Все OBJECTS доступны всегда, но их наполнение зависит от момента (обычно нет ситуаций когда чего-то не хватает)
