from __future__ import annotations

from collections.abc import Mapping
from dataclasses import fields, is_dataclass
from typing import Any

from pydantic import BaseModel


SCALAR_TYPES = (str, int, float, bool, bytes, type(None))


def normalize(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump()

    return value


def is_leaf(value: Any) -> bool:
    value = normalize(value)

    return isinstance(
        value,
        SCALAR_TYPES + (Mapping, list, tuple, set),
    )


def public_children(obj: Any) -> list[Any]:
    result: list[Any] = []

    # class container
    if isinstance(obj, type):
        for name, value in vars(obj).items():
            if name.startswith("_"):
                continue

            if isinstance(value, (staticmethod, classmethod)):
                continue

            if callable(value) and not isinstance(value, type):
                continue

            result.append(value)

        return result

    # pydantic model as atomic value
    if isinstance(obj, BaseModel):
        return []

    # dataclass instance
    if is_dataclass(obj) and not isinstance(obj, type):
        for field in fields(obj):
            if field.name.startswith("_"):
                continue

            result.append(getattr(obj, field.name))

    # normal instance public attrs
    if hasattr(obj, "__dict__"):
        for name, value in vars(obj).items():
            if name.startswith("_"):
                continue

            if callable(value):
                continue

            result.append(value)

    # public @property
    for name, descriptor in vars(type(obj)).items():
        if name.startswith("_"):
            continue

        if isinstance(descriptor, property):
            result.append(getattr(obj, name))

    return result


def collect_allowed_values(parent: Any) -> list[Any]:
    result: list[Any] = []
    seen: set[int] = set()

    def walk(value: Any) -> None:
        value = normalize(value)

        if is_leaf(value):
            result.append(value)
            return

        value_id = id(value)
        if value_id in seen:
            return
        seen.add(value_id)

        for child in public_children(value):
            walk(child)

    walk(parent)
    return result


def is_allowed_value(value: Any, parent: Any) -> bool:
    value = normalize(value)

    return value in collect_allowed_values(parent)


def validate_allowed_value(value: Any, parent: Any) -> Any:
    value = normalize(value)

    allowed = collect_allowed_values(parent)

    if value not in allowed:
        raise ValueError(
            f"Invalid value {value!r}. Allowed values: {allowed!r}"
        )

    return value


from pprint import pprint
from example import CatalogFeedSort
pprint(collect_allowed_values(CatalogFeedSort))
print(is_allowed_value({"orderDirection": "asc", "orderBy": "price"}, CatalogFeedSort)) # True
print(is_allowed_value(CatalogFeedSort.Price.ASC, CatalogFeedSort)) # True
print(is_allowed_value(CatalogFeedSort, CatalogFeedSort)) # False
print()

from example2 import BannerPlace
pprint(collect_allowed_values(BannerPlace))
print(is_allowed_value("web_brands", BannerPlace)) # True
print(is_allowed_value(BannerPlace.BRANDS, BannerPlace)) # True
print(is_allowed_value(BannerPlace, BannerPlace)) # False