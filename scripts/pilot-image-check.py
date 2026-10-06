#!/usr/bin/env python3
"""Decode bounded JPEG/PNG input; never print image content or metadata."""
import io
import sys
import warnings
from PIL import Image, ImageFile

Image.MAX_IMAGE_PIXELS = 24_000_000
ImageFile.LOAD_TRUNCATED_IMAGES = False
warnings.simplefilter("error", Image.DecompressionBombWarning)
if sys.argv[1:] == ["--check"]:
    print("Pillow decoder available")
    sys.exit(0)
try:
    data = sys.stdin.buffer.read(20 * 1024 * 1024 + 1)
    if not data or len(data) > 20 * 1024 * 1024:
        raise ValueError()
    with Image.open(io.BytesIO(data)) as image:
        if image.format not in {"JPEG", "PNG"} or image.width * image.height > 24_000_000:
            raise ValueError()
        if getattr(image, "n_frames", 1) != 1:
            raise ValueError()
        image.verify()
    with Image.open(io.BytesIO(data)) as image:
        image.load()
    print("OK")
except Exception:
    print("Invalid photo", file=sys.stderr)
    sys.exit(1)
