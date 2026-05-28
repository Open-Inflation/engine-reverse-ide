from dataclasses import dataclass
from typing import Literal
from pydantic import BaseModel


class _SortParams(BaseModel):
    orderBy: str
    orderDirection: Literal["asc", "desc"]


@dataclass(frozen=True)
class _SortOption:
    """Опция сортировки с направлениями ASC/DESC."""

    _order_by: str

    @property
    def ASC(self) -> _SortParams:
        return _SortParams(
            orderBy=self._order_by,
            orderDirection="asc",
        )

    @property
    def DESC(self) -> _SortParams:
        return _SortParams(
            orderBy=self._order_by,
            orderDirection="desc",
        )

class CatalogFeedSort:
    """Опции сортировки для фидов каталога товаров."""

    Price = _SortOption("price")
    """Сортировка по цене"""

    Popularity = _SortOption("popularity")
    """Сортировка по популярности"""

    Discount = _SortOption("discount")
    """Сортировка по размеру скидки"""

    Rating = _SortOption("rating")
    """Сортировка по рейтингу"""

    Recommended = _SortOption("popularity_without_manual")
    """Рекомендуемая сортировка (популярность без ручной настройки)"""    
