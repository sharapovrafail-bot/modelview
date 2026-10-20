"""Рисует иконку ModelView (синий изометрический куб) в build/modelview.ico."""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "modelview.ico")
S = 256  # рисуем крупно, Windows сама берёт нужные размеры из .ico


def draw():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # фон — скруглённый тёмно-синий квадрат
    d.rounded_rectangle([8, 8, S - 8, S - 8], radius=52, fill=(13, 20, 34, 255))
    cx, cy, r = S / 2, S / 2 + 4, 92
    top = (cx, cy - r)
    ul, ur = (cx - r * 0.87, cy - r / 2), (cx + r * 0.87, cy - r / 2)
    ll, lr = (cx - r * 0.87, cy + r / 2), (cx + r * 0.87, cy + r / 2)
    bot, mid = (cx, cy + r), (cx, cy)
    d.polygon([top, ur, mid, ul], fill=(110, 168, 255, 255))   # верх
    d.polygon([ul, mid, bot, ll], fill=(47, 123, 255, 255))    # лево
    d.polygon([mid, ur, lr, bot], fill=(30, 86, 200, 255))     # право
    w = 7
    for a, b in [(top, ur), (ur, lr), (lr, bot), (bot, ll), (ll, ul), (ul, top), (mid, ul), (mid, ur), (mid, bot)]:
        d.line([a, b], fill=(235, 243, 255, 255), width=w, joint="curve")
    return img


if __name__ == "__main__":
    draw().save(OUT, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("icon:", OUT)
