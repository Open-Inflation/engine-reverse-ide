from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError


LOGO_LIGHT_NAME = "logo-light.webp"
LOGO_DARK_NAME = "logo-dark.webp"


def build_logo_assets(
    project: dict[str, Any],
    source_root: Path,
    static_root: Path,
) -> dict[str, str] | None:
    logo_value = str(project.get("app", {}).get("logo") or "").strip()
    if not logo_value:
        return None

    source_path = resolve_logo_source_path(source_root, logo_value)
    if not source_path.is_file():
        raise FileNotFoundError(f'app.logo points to a missing file: {source_path}')

    source_image = load_logo_image(source_path)
    source_polarity = detect_logo_polarity(source_image, source_path)
    light_image, dark_image = build_logo_variants(source_image, source_polarity)

    light_target = static_root / LOGO_LIGHT_NAME
    dark_target = static_root / LOGO_DARK_NAME
    save_logo_variant(light_image, light_target)
    save_logo_variant(dark_image, dark_target)
    return {
        "light_name": LOGO_LIGHT_NAME,
        "dark_name": LOGO_DARK_NAME,
    }


def resolve_logo_source_path(source_root: Path, logo_value: str) -> Path:
    candidate = Path(logo_value).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()
    return (source_root / candidate).resolve()


def load_logo_image(source_path: Path) -> Image.Image:
    try:
        with Image.open(source_path) as image:
            return image.convert("RGBA")
    except (OSError, UnidentifiedImageError) as exc:
        raise ValueError(
            f'app.logo must point to a raster image Pillow can read: {source_path}'
        ) from exc


def detect_logo_polarity(source_image: Image.Image, source_path: Path) -> str:
    pixels = source_image.load()
    width, height = source_image.size
    visible_pixels = 0
    visible_red_sum = 0
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            visible_pixels += 1
            if red != green or green != blue:
                raise ValueError(
                    "app.logo must be a monochrome black-and-white raster image; "
                    f"colored pixel at ({x}, {y}) is RGBA=({red}, {green}, {blue}, {alpha}): {source_path}"
                )
            visible_red_sum += red
    if visible_pixels == 0:
        raise ValueError(f"app.logo must contain at least one visible pixel: {source_path}")
    return "white" if visible_red_sum * 2 >= visible_pixels * 255 else "black"


def build_logo_variants(source_image: Image.Image, source_polarity: str) -> tuple[Image.Image, Image.Image]:
    black_variant = source_image if source_polarity == "black" else invert_logo_image(source_image)
    white_variant = source_image if source_polarity == "white" else invert_logo_image(source_image)
    return black_variant, white_variant


def invert_logo_image(source_image: Image.Image) -> Image.Image:
    red, green, blue, alpha = source_image.split()
    rgb = Image.merge("RGB", (red, green, blue))
    inverted_rgb = ImageOps.invert(rgb)
    return Image.merge("RGBA", (*inverted_rgb.split(), alpha))


def save_logo_variant(source_image: Image.Image, target_path: Path) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        source_image.save(target_path, format="WEBP", lossless=True, method=6, exact=True)
    except (OSError, ValueError) as exc:
        raise ValueError(
            f"app.logo output requires WebP support in Pillow: {target_path}"
        ) from exc
