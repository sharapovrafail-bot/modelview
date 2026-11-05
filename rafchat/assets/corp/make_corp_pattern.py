"""Фон «Общего чата»: контуры логотипа организации, как обои WhatsApp (серые линии, повторяющаяся плитка).
Вход: corp/logo_edges.png (белые контуры на прозрачном). Выход: corp_pattern.png 960×960 (ПК и Android)."""
from pathlib import Path
from PIL import Image

here = Path(__file__).resolve().parent
edges = Image.open(here / "logo_edges.png").convert("L")
N = 960
tile = Image.new("L", (N, N), 0)
# (центр x, центр y, высота, поворот) — вразнобой, как «дудлы»
spots = [(180, 200, 300, -12), (620, 150, 230, 14), (420, 560, 330, 6), (820, 560, 210, -20),
         (140, 760, 230, 18), (650, 900, 190, -8)]
for cx, cy, hgt, rot in spots:
    w = int(edges.width * hgt / edges.height)
    e = edges.resize((w, hgt), Image.LANCZOS).rotate(rot, expand=True, resample=Image.BICUBIC)
    for dx in (-N, 0, N):                      # переносим через края — плитка без швов
        for dy in (-N, 0, N):
            x, y = cx - e.width // 2 + dx, cy - e.height // 2 + dy
            layer = Image.new("L", (N, N), 0)
            layer.paste(e, (x, y))
            tile = Image.fromarray(__import__("numpy").maximum(__import__("numpy").array(tile), __import__("numpy").array(layer)))
color = (0x9A, 0xA3, 0xAF)
out = Image.new("RGBA", (N, N), color + (0,))
out.putalpha(tile.point(lambda v: int(v * 0.55)))
out.save(here.parent / "corp_pattern.png")
print("ok")
