#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10"]
# ///
"""Assemble Playwright-captured demo frames into the README's looping GIF."""

import argparse
import sys
from pathlib import Path

from PIL import Image


BENCHMARK_WIDTH = 2240
BENCHMARK_HEIGHT = 1400

# demo-video.spec.js captures a wall-clock window, so frame count varies; divide by frames landed.
TARGET_DURATION_MS = 60_000


def load_frames(frames_dir: Path) -> list[Path]:
    """Return every captured frame PNG, sorted by its zero-padded sequence number."""

    frames = sorted(frames_dir.glob("frame_*.png"))

    if not frames:
        print(f"No frame_*.png files found under {frames_dir}", file=sys.stderr)
        sys.exit(1)

    return frames


def downsample(im: Image.Image) -> Image.Image:
    """Resize a captured frame to the benchmark 2240x1400 output dimensions."""

    return im.resize((BENCHMARK_WIDTH, BENCHMARK_HEIGHT), Image.LANCZOS)


def build_shared_palette(frames: list[Image.Image]) -> Image.Image:
    """One shared adaptive palette, not per-frame: lets the encoder delta-encode, ~16x smaller."""

    sample_count = min(24, len(frames))
    step = max(1, len(frames) // sample_count)
    samples = frames[::step][:sample_count]

    tile_w, tile_h = samples[0].size
    cols = 6
    rows = (len(samples) + cols - 1) // cols
    montage = Image.new("RGB", (tile_w * cols, tile_h * rows))

    for i, frame in enumerate(samples):
        x = (i % cols) * tile_w
        y = (i // cols) * tile_h
        montage.paste(frame, (x, y))

    return montage.quantize(colors=256, method=Image.MEDIANCUT)


def assemble_gif(frames_dir: Path, output_path: Path) -> None:
    """Downsample, palette-quantize, and encode captured frames into a looping GIF."""

    frame_paths = load_frames(frames_dir)
    print(f"Loading {len(frame_paths)} frames from {frames_dir}")

    # Pillow floors GIF delays to centiseconds - round to the nearest 10ms.
    frame_delay_ms = max(10, round(TARGET_DURATION_MS / len(frame_paths) / 10) * 10)

    frames = [downsample(Image.open(p).convert("RGB")) for p in frame_paths]

    palette_image = build_shared_palette(frames)
    quantized = [
        frame.quantize(palette=palette_image, dither=Image.Dither.NONE) for frame in frames
    ]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    quantized[0].save(
        output_path,
        save_all=True,
        append_images=quantized[1:],
        duration=frame_delay_ms,
        loop=0,
        optimize=True,
        disposal=0,  # Never 2 (restore-to-background) - measured ~16x larger on this content.
    )

    size_bytes = output_path.stat().st_size

    with Image.open(output_path) as result:
        frame_count = result.n_frames
        dimensions = result.size

    print(
        f"Wrote {output_path}: {dimensions[0]}x{dimensions[1]}, "
        f"{frame_count} frames, {size_bytes:,} bytes ({size_bytes / 1_000_000:.1f} MB)",
    )


def main() -> None:
    """Parse CLI arguments and assemble the GIF."""

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--frames-dir",
        type=Path,
        default=Path("/tmp/claudebox--demo-frames"),
        help="Directory of frame_NNNN.png files captured by demo-video.spec.js",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("docs/demo.gif"),
        help="Output GIF path",
    )
    args = parser.parse_args()

    assemble_gif(args.frames_dir, args.output)


if __name__ == "__main__":
    main()
