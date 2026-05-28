from example import CatalogFeedSort
from example2 import BannerPlace

async def info(
    self,
    *,
    feed_sort: CatalogFeedSort,
    place: BannerPlace = BannerPlace.MAIN_BANNERS
) -> Output:
    pass