# UI_DESIGN §6-1 量化校色：对徽章原图 quantize，产出四主令牌候选值与白字对比度。
# 用法：python scripts/calibrate_tokens.py <badge.jpg>
import sys
from PIL import Image


def hexc(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb[:3])


def lum(rgb):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(c) for c in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = lum(a), lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


img = Image.open(sys.argv[1]).convert("RGB")
q = img.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
pal = q.getpalette()
counts = sorted(q.getcolors(), reverse=True)
total = img.width * img.height
print(f"size={img.width}x{img.height}")
for n, idx in counts:
    rgb = tuple(pal[idx * 3:idx * 3 + 3])
    print(f"{hexc(rgb)}  {n / total:6.2%}  contrast_vs_white={contrast(rgb, (255, 255, 255)):.2f}  contrast_vs_ink={(lambda: (max(lum(rgb), lum((0x2b,0x1d,0x12)))+0.05)/(min(lum(rgb), lum((0x2b,0x1d,0x12)))+0.05))():.2f}")
