from __future__ import annotations

from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError


LOGO_LIGHT_NAME = "logo-light.png"
LOGO_DARK_NAME = "logo-dark.png"


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
    validate_monochrome_logo(source_image, source_path)

    light_target = static_root / LOGO_LIGHT_NAME
    dark_target = static_root / LOGO_DARK_NAME
    render_logo_variant(source_image, light_target, invert=False)
    render_logo_variant(source_image, dark_target, invert=True)

    display_name = str(
        project.get("app", {}).get("name")
        or project.get("app", {}).get("package_name")
        or "logo"
    ).strip() or "logo"
    return {
        "light_name": LOGO_LIGHT_NAME,
        "dark_name": LOGO_DARK_NAME,
        "light_static_path": f"_static/{LOGO_LIGHT_NAME}",
        "dark_static_path": f"_static/{LOGO_DARK_NAME}",
        "light_readme_path": f"docs/source/_static/{LOGO_LIGHT_NAME}",
        "dark_readme_path": f"docs/source/_static/{LOGO_DARK_NAME}",
        "alt": f"{display_name} logo",
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


def validate_monochrome_logo(source_image: Image.Image, source_path: Path) -> None:
    pixels = source_image.load()
    width, height = source_image.size
    visible_pixels = 0
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
    if visible_pixels == 0:
        raise ValueError(f"app.logo must contain at least one visible pixel: {source_path}")


def render_logo_variant(source_image: Image.Image, target_path: Path, *, invert: bool) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    red, green, blue, alpha = source_image.split()
    rgb = Image.merge("RGB", (red, green, blue))
    if invert:
        rgb = ImageOps.invert(rgb)
    rendered = Image.merge("RGBA", (*rgb.split(), alpha))
    rendered.save(target_path)
