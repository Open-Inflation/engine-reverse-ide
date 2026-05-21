
Стандартный язык TOML с объектными вставками вида `<OBJECT>` или `<OBJECT.value>`

Доступные OBJECTS:
1. UNSTANDART_HEADERS (.RESPONSE или .REQUEST -> {key: value})
2. UNSTANDART_URLS (.RESPONSE или .REQUEST -> array)
* оба метода дополняются исключительно сниффером при warmup

3. INPUT -> any data
4. VARIABLES (.any_key) -> any data   
5. DOCUMENT (.PREFIXES или .REGEX) -> any data (позволяет получить доступ к другим переменным в toml)
