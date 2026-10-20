"""Иконка RafCAD View из build/icon-source.webp:
обрезка по скруглённому квадрату, прозрачные углы ->
  build/rafcadview.ico  (16…256 px, для exe, установщика, ярлыков)
  app/img/logo.png      (256 px, логотип в окне и значок вкладки)
"""
import os
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "icon-source.webp")
ICO = os.path.join(HERE, "rafcadview.ico")
PNG = os.path.join(HERE, "..", "app", "img", "logo.png")

CROP = (36, 48, 636, 648)   # рамка иконки на исходной картинке 724×724
RADIUS = 0.17               # скругление углов, доля стороны


def build():
    im = Image.open(SRC).convert("RGBA").crop(CROP)
    size = im.size[0]
    # маска со сглаженными краями: рисуем вчетверо крупнее и уменьшаем
    big = size * 4
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, big - 1, big - 1], radius=int(big * RADIUS), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    im.putalpha(mask)
    return im


if __name__ == "__main__":
    icon = build()
    master = icon.resize((256, 256), Image.LANCZOS)
    os.makedirs(os.path.dirname(PNG), exist_ok=True)
    master.save(PNG)
    # мелкие размеры чуть подтягиваем по резкости, иначе деталь «плывёт»
    frames = []
    for s in (16, 20, 24, 32, 40, 48, 64, 128, 256):
        f = icon.resize((s, s), Image.LANCZOS)
        if s <= 48:
            f = f.filter(ImageFilter.UnsharpMask(radius=1, percent=80, threshold=2))
        frames.append(f)
    frames[-1].save(ICO, sizes=[f.size for f in frames], append_images=frames[:-1])
    print("icon ok:", os.path.basename(ICO))
