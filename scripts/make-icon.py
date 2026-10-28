#!/usr/bin/env python3
"""
生成插件图标位图（catalog / storefront 只接受 GitHub 托管的位图）。

设计源是本文件里的几何常量，与仓库根 icon.svg 对应：
- 灰色调，单一主体（键帽），无文字、无角标；
- 键帽里放两个 chevron（»）表示「快」，键帽本身表示「快捷键」。

本机没有 rsvg/inkscape/ImageMagick，所以直接用 Pillow 按坐标绘制。

用法：
    python3 scripts/make-icon.py                     # 生成默认方案 assets/icon-180.png
    python3 scripts/make-icon.py --variant c1        # 指定方案（c1 平面 / c2 微立体）
    python3 scripts/make-icon.py --out /tmp/x.png    # 指定输出路径
    python3 scripts/make-icon.py --preview           # 额外生成 96px 预览检查小尺寸可读性
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
GRID = 512

# 灰色调：上浅下深的钢灰渐变底
TILE_TOP = (168, 175, 184)
TILE_BOTTOM = (94, 100, 108)
NEAR_WHITE = (248, 250, 252)
FACE_TOP = (244, 246, 249)
FACE_BOTTOM = (214, 220, 228)
SKIRT = (73, 79, 86)
GRAPHITE = (46, 51, 57)

# 科技灰：冷调深灰底 + 背后柔光
TECH_TOP = (74, 82, 92)
TECH_BOTTOM = (23, 27, 33)
GLOW = (198, 208, 219)
SKIRT_TOP = (112, 120, 130)
SKIRT_BOTTOM = (44, 49, 57)


def build(variant: str, size: int) -> Image.Image:
    scale = size / GRID

    def s(value: float) -> float:
        return value * scale

    def px(value: float, minimum: int = 1) -> int:
        return max(minimum, round(s(value)))

    # ── 底：圆角方块 + 竖向渐变 ────────────────────────────────────────────
    gradient = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(gradient)
    for y in range(size):
        mix = y / max(1, size - 1)
        color = tuple(round(a + (b - a) * mix) for a, b in zip(TILE_TOP, TILE_BOTTOM))
        draw.line([(0, y), (size, y)], fill=color + (255,))
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [s(8), s(8), s(504), s(504)], radius=round(s(112)), fill=255
    )
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(gradient, (0, 0), mask)

    # ── 键帽几何 ──────────────────────────────────────────────────────────
    key = [s(110), s(172), s(402), s(348)]
    key_radius = round(s(48))
    chevron_center = (s(256), s(260))
    chevron_height = s(84)
    chevron_depth = s(38)
    chevron_gap = s(42)
    chevron_width = px(22)

    def chevrons(layer: Image.Image, color) -> None:
        pen = ImageDraw.Draw(layer)
        for offset in (-chevron_gap / 2, chevron_gap / 2):
            x = chevron_center[0] + offset
            points = [
                (x - chevron_depth / 2, chevron_center[1] - chevron_height / 2),
                (x + chevron_depth / 2, chevron_center[1]),
                (x - chevron_depth / 2, chevron_center[1] + chevron_height / 2),
            ]
            pen.line(points, fill=color, width=chevron_width, joint="curve")
            radius = chevron_width / 2
            for cx, cy in (points[0], points[-1]):
                pen.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color)

    if variant == "c3":
        # 科技灰底：冷调深灰渐变 + 背后柔光，键帽立体感更强
        tech = Image.new("RGBA", (size, size))
        pen = ImageDraw.Draw(tech)
        for y in range(size):
            mix = y / max(1, size - 1)
            color = tuple(round(a + (b - a) * mix) for a, b in zip(TECH_TOP, TECH_BOTTOM))
            pen.line([(0, y), (size, y)], fill=color + (255,))
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(tech, (0, 0), mask)

        # 背后的柔光，把键帽从底上托起来
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(glow).ellipse(
            [s(126), s(96), s(386), s(376)], fill=GLOW + (62,)
        )
        canvas.alpha_composite(glow.filter(ImageFilter.GaussianBlur(radius=max(1, s(54)))))

        # 投影
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            [key[0], key[1] + s(36), key[2], key[3] + s(36)],
            radius=key_radius,
            fill=(3, 5, 7, 150),
        )
        canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(radius=max(1, s(15)))))

        # 侧裙（带渐变，做出厚度）
        skirt = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        skirt_draw = ImageDraw.Draw(skirt)
        top_y, bottom_y = key[1] + s(32), key[3] + s(32)
        for y in range(int(top_y), int(bottom_y) + 1):
            mix = (y - top_y) / max(1, bottom_y - top_y)
            color = tuple(round(a + (b - a) * mix) for a, b in zip(SKIRT_TOP, SKIRT_BOTTOM))
            skirt_draw.line([(key[0], y), (key[2], y)], fill=color + (255,))
        skirt_mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(skirt_mask).rounded_rectangle(
            [key[0], key[1] + s(32), key[2], key[3] + s(32)], radius=key_radius, fill=255
        )
        canvas.paste(skirt, (0, 0), skirt_mask)

        # 键面：白→浅灰渐变 + 顶部高光
        face = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        face_draw = ImageDraw.Draw(face)
        for y in range(int(key[1]), int(key[3]) + 1):
            mix = (y - key[1]) / max(1, key[3] - key[1])
            color = tuple(round(a + (b - a) * mix) for a, b in zip(FACE_TOP, FACE_BOTTOM))
            face_draw.line([(key[0], y), (key[2], y)], fill=color + (255,))
        face_mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(face_mask).rounded_rectangle(key, radius=key_radius, fill=255)
        canvas.paste(face, (0, 0), face_mask)

        # 键面底部的淡内阴影，键面看起来是向下收的弧面
        inner = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        inner_draw = ImageDraw.Draw(inner)
        inner_top = key[3] - s(56)
        for y in range(int(inner_top), int(key[3]) + 1):
            mix = (y - inner_top) / max(1, key[3] - inner_top)
            inner_draw.line([(key[0], y), (key[2], y)], fill=(24, 28, 34, round(34 * mix)))
        inner_mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(inner_mask).rounded_rectangle(key, radius=key_radius, fill=255)
        canvas.paste(inner, (0, 0), Image.composite(inner_mask, Image.new("L", (size, size), 0), face_mask))

        # 顶部一道细高光，强化「凸起」
        ImageDraw.Draw(canvas).rounded_rectangle(
            [key[0] + s(26), key[1] + s(6), key[2] - s(26), key[1] + s(16)],
            radius=round(s(6)),
            fill=(255, 255, 255, 150),
        )

        chevrons(canvas, GRAPHITE + (255,))
    elif variant == "c1":
        # 平面：白色键帽描边 + 白色 chevrons，最简
        ImageDraw.Draw(canvas).rounded_rectangle(
            key, radius=key_radius, outline=NEAR_WHITE + (255,), width=px(24)
        )
        chevrons(canvas, NEAR_WHITE + (255,))
    else:
        # 微立体：柔和阴影 + 深色侧裙 + 浅色键面
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle(
            [key[0], key[1] + s(20), key[2], key[3] + s(20)],
            radius=key_radius,
            fill=(30, 34, 39, 80),
        )
        canvas.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(radius=max(1, s(12)))))

        ImageDraw.Draw(canvas).rounded_rectangle(
            [key[0], key[1] + s(18), key[2], key[3] + s(18)],
            radius=key_radius,
            fill=SKIRT + (255,),
        )

        face = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        face_mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(face_mask).rounded_rectangle(key, radius=key_radius, fill=255)
        gradient_face = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        face_draw = ImageDraw.Draw(gradient_face)
        for y in range(int(key[1]), int(key[3]) + 1):
            mix = (y - key[1]) / max(1, key[3] - key[1])
            color = tuple(round(a + (b - a) * mix) for a, b in zip(FACE_TOP, FACE_BOTTOM))
            face_draw.line([(key[0], y), (key[2], y)], fill=color + (255,))
        face.paste(gradient_face, (0, 0), face_mask)
        canvas.alpha_composite(face)

        chevrons(canvas, GRAPHITE + (255,))

    return canvas


def main() -> int:
    parser = argparse.ArgumentParser(description="生成 dsh-quick-keys 图标位图")
    parser.add_argument("--variant", choices=("c1", "c2", "c3"), default="c3",
                        help="c1=平面，c2=浅灰底微立体，c3=科技灰底立体键帽")
    parser.add_argument("--size", type=int, default=180, help="输出边长（默认 180）")
    parser.add_argument("--out", type=Path, help="输出路径；缺省写 assets/icon-<size>.png")
    parser.add_argument("--preview", action="store_true", help="额外生成 96px 预览")
    args = parser.parse_args()

    image = build(args.variant, args.size)
    target = args.out or (ROOT / "assets" / f"icon-{args.size}.png")
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, "PNG", optimize=True)
    print(f"written: {target}  {target.stat().st_size} bytes  {image.size[0]}x{image.size[1]}  variant={args.variant}")

    if args.preview:
        preview = image.resize((96, 96), Image.LANCZOS)
        preview_path = target.with_name(target.stem + "-96.png")
        preview.save(preview_path, "PNG", optimize=True)
        print(f"preview: {preview_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
