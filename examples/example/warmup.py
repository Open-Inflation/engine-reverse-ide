from human_requests.network_analyzer.anomaly_sniffer import WaitHeader, WaitSource

from human_requests.abstraction import Warmup


async def pipeline(warmup: Warmup):
    start_url = warmup.prefixes.get("MAIN_SITE_URL") or warmup.prefixes.get("ORIGIN")
    if start_url is None:
        raise KeyError("Warmup requires MAIN_SITE_URL or ORIGIN prefix")

    await warmup.page.goto(start_url, wait_until="domcontentloaded")
    await warmup.page.wait_for_load_state("networkidle")

    if warmup.sniffer is not None:
        await warmup.sniffer.wait(
            tasks=[
                WaitHeader(
                    source=WaitSource.REQUEST,
                    headers=["X-Key"],
                )
            ],
            timeout_ms=warmup.timeout_ms,
        )

    if warmup.test_mode:
        await warmup.page.wait_for_selector(
            selector="div.selected-city > div.buttons > button.button.normal",
            timeout=warmup.timeout_ms,
            state="visible",
        )
        locator = warmup.page.locator("div.selected-city > div.buttons > button.button.normal").first
        await locator.click(timeout=warmup.timeout_ms)

        await warmup.page.wait_for_selector(
            selector="a.link.product-category",
            timeout=warmup.timeout_ms,
            state="visible",
        )
        locator = warmup.page.locator("a.link.product-category").first
        await locator.click(timeout=warmup.timeout_ms)

        await warmup.page.wait_for_selector(
            selector="div.page-content",
            timeout=warmup.timeout_ms,
            state="visible",
        )

        await warmup.page.wait_for_load_state("load")

    await warmup.page.wait_for_selector(
        selector="body > pre",
        timeout=warmup.timeout_ms,
        state="visible",
    )
