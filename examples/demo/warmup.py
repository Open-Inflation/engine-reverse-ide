from human_requests.abstraction import Warmup


async def pipeline(warmup: Warmup):
    await warmup.page.goto(warmup.prefixes["MAIN_SITE_URL"], wait_until="domcontentloaded")
