@overload
async def info(
    self,
    *,
    url: str,
    detalization: Literal["short"] = "short",
    yes: bool | None = None,
) -> Output: ...

@overload
async def info(
    self,
    *,
    category: str,
    product_id: int,
    slug: str,
    detalization: Literal["full", "short"] = "full",
    yes: bool | None = None,
) -> Output: ...

@overload
async def info(
    self,
    *,
    detalization: Literal["full", "short"] = "short",
    yes: bool | None = None,
) -> Output: ...

async def info(
    self,
    *,
    url: str | None = None,
    category: str | None = None,
    product_id: int | None = None,
    slug: str | None = None,
    detalization: Literal["full", "short"] | None = None,
    yes: bool | None = None,
) -> Output:
    # Выбор overload'a
    matched: list[str] = []

    # fullurl:
    # url required
    # category/product_id/slug are not allowed
    if (
        url is not None
        and category is None
        and product_id is None
        and slug is None
    ):
        matched.append("fullurl")
    
    # structured:
    # category/product_id/slug required
    # url are not allowed
    if (
        url is None
        and category is not None
        and product_id is not None
        and slug is not None
    ):
        matched.append("structured")

    # default:
    # url/category/product_id/slug are not allowed
    if (
        url is None
        and category is None
        and product_id is None
        and slug is None
    ):
        matched.append("default")
    
    if not matched:
        raise TypeError(
            "info() expected one of: "
            "1. url=..., "
            "2. category=... + product_id=... + slug=..., "
            "3. no required identifier"
        )
    elif len(matched) > 1:
        raise TypeError(
            f"info() call is ambiguous; matched overloads: {matched}"
        )
    else:
        matched_overload = matched[0]

    if "fullurl" == matched_overload:
        if detalization is None:
            detalization = "short"
    elif "structured" == matched_overload:
        if detalization is None:
            detalization = "full"
    elif "default" == matched_overload:
        url = "some-category/p-12345-some-product"
    
    if url is not None:
        if not isinstance(url, str):
            raise TypeError("`url` must be str")
    elif "fullurl" == matched_overload:
        raise ValueError("url for overload \"fullurl\" required")

    if category is not None:
        if not isinstance(category, str):
            raise TypeError("`category` must be str")
    elif "structured" == matched_overload:
        raise ValueError("category for overload \"structured\" required")
    
    if product_id is not None:
        if not isinstance(product_id, int) or isinstance(product_id, bool):
            raise TypeError("`product_id` must be int")
        if product_id < 1 or product_id > 2147483647:
            raise ValueError("`product_id` must be between 1 and 2147483647")
    elif "structured" == matched_overload:
        raise ValueError("product_id for overload \"structured\" required")
    
    if slug is not None:
        if not isinstance(slug, str):
            raise TypeError("`slug` must be str")
    elif "structured" == matched_overload:
        raise ValueError("slug for overload \"structured\" required")

    if "fullurl" == matched_overload and detalization not in ["short"]:
        raise ValueError("detalization for overload fullurl must be \"short\"")
    elif detalization not in ["full", "short"]:
        raise ValueError("detalization must be any of \"full\", \"short\"")
    
    if yes is not None:
        if not isinstance(yes, bool):
            raise TypeError("`yes` must be bool")
    
    # Подготовка url, body и параметров

    if url is not None and yes == True:
        request_url = str(self._parent._MAIN_SITE_ORIGIN) + "/catalog/" + str(url) + "/yes"
    elif url is not None:
        request_url = str(self._parent._MAIN_SITE_ORIGIN) + "/catalog/" + str(url)
    elif category is not None and product_id is not None and slug is not None:
        request_url = str(self._parent._MAIN_SITE_ORIGIN) + "/catalog/" + str(category) + "/p-" + str(product_id) + "-" + str(slug)
    else:
        raise TypeError("info() call is ambiguous; URL cannot be collected")

    query_params: list[tuple[str, object]] = []
    if detalization:
        query_params.append(("detalization", detalization))

    if query_params:
        request_url += "?" + urlencode(query_params, doseq=True)
