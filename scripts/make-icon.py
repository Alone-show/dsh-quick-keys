#!/usr/bin/env python3
"""把 icon.svg 光栅化成 catalog 用的位图（assets/icon-*.png）。

设计只有一处源：仓库根目录的 `icon.svg`。
本脚本不再自己按坐标画一遍（那样会和 SVG 各画一份、迟早对不上），
而是调用本机任意一个 SVG 渲染器把 `icon.svg` 渲出来，再用 Pillow 缩放。

渲染器按顺序探测：
  1. Python 的 cairosvg            `pip install cairosvg`
  2. resvg CLI                     `cargo install resvg` / 发行版包
  3. rsvg-convert (librsvg)        `apt install librsvg2-bin` / `brew install librsvg`
  4. inkscape CLI

仓库里已经提交了生成好的 PNG，所以**只有改图标时**才需要跑本脚本。

用法：
    python3 scripts/make-icon.py              # 重新生成 assets/ 下 512 / 180 / 64 三张
    python3 scripts/make-icon.py --size 180   # 只生成一张
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVG = ROOT / "icon.svg"
ASSETS = ROOT / "assets"

# 512 = social preview / 大图；180 = 插件市场卡片；64 = README 里的小图
SIZES = {"512": 512, "180": 180, "64": 64}


def render_with_cairosvg(svg: Path, out: Path, size: int) -> bool:
    try:
        import cairosvg  # type: ignore
    except ImportError:
        return False
    cairosvg.svg2png(url=str(svg), write_to=str(out), output_width=size, output_height=size)
    return True


def render_with_cli(svg: Path, out: Path, size: int) -> str | None:
    commands = {
        "resvg": ["resvg", "--width", str(size), "--height", str(size), str(svg), str(out)],
        "rsvg-convert": ["rsvg-convert", "-w", str(size), "-h", str(size), "-o", str(out), str(svg)],
        "inkscape": [
            "inkscape", str(svg),
            f"--export-width={size}", f"--export-height={size}", f"--export-filename={out}",
        ],
    }
    for name, cmd in commands.items():
        try:
            subprocess.run(cmd, check=True, capture_output=True)
            return name
        except FileNotFoundError:
            continue
        except subprocess.CalledProcessError as exc:
            detail = exc.stderr.decode(errors="replace").strip().splitlines()
            print(f"  {name} 渲染失败：{detail[-1] if detail else exc}", file=sys.stderr)
            continue
    return None


def render(svg: Path, out: Path, size: int) -> str:
    if render_with_cairosvg(svg, out, size):
        return "cairosvg"
    used = render_with_cli(svg, out, size)
    if used:
        return used
    raise SystemExit(
        "找不到任何 SVG 渲染器，装一个即可：\n"
        "  pip install cairosvg\n"
        "  # 或 apt install librsvg2-bin（提供 rsvg-convert）\n"
        "assets/ 里已经提交了生成好的 PNG，不改图标的话不需要跑这个脚本。"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="由 icon.svg 生成 assets/ 里的位图")
    parser.add_argument("--size", choices=sorted(SIZES, key=int), help="只生成某个尺寸（默认全部）")
    args = parser.parse_args()

    if not SVG.exists():
        raise SystemExit(f"icon.svg 不存在：{SVG}")
    ASSETS.mkdir(exist_ok=True)

    try:
        from PIL import Image  # type: ignore
    except ImportError:
        raise SystemExit("缩放需要 Pillow：pip install Pillow") from None

    with tempfile.TemporaryDirectory() as tmp:
        master = Path(tmp) / "icon-512.png"
        renderer = render(SVG, master, 512)
        print(f"renderer: {renderer}")

        for key in ([args.size] if args.size else list(SIZES)):
            size = SIZES[key]
            target = ASSETS / f"icon-{size}.png"
            image = Image.open(master).convert("RGBA")
            if size != 512:
                image = image.resize((size, size), Image.LANCZOS)
            image.save(target, "PNG", optimize=True)
            print(f"written: {target}  {size}x{size}  {target.stat().st_size}B")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
