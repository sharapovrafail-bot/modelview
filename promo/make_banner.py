"""Баннер YouTube-канала 2560×1440 (важное — в центре 1546×423, видно на всех устройствах)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
F = "/usr/share/fonts/opentype/inter/Inter-{}.otf"
W, H = 2560, 1440
im = Image.new("RGB", (W, H))
d = ImageDraw.Draw(im)
for y in range(H):
    k = y / H
    d.line((0, y, W, y), fill=(int(12 + 14 * k), int(18 + 18 * k), int(30 + 26 * k)))
for x in range(0, W, 64):
    d.line((x, 0, x, H), fill=(30, 42, 64))
for y in range(0, H, 64):
    d.line((0, y, W, y), fill=(30, 42, 64))
# по краям — окна программ (видны на телевизоре и ПК)
for name, box in [("rafcadview.png", (30, 470, 520)), ("stz-simulyator.png", (2010, 470, 520))]:
    s = Image.open(ROOT / "docs/img" / name).convert("RGB")
    k = box[2] / s.width
    s = s.resize((box[2], int(s.height * k)), Image.LANCZOS)
    s = Image.blend(Image.new("RGB", s.size, (12, 18, 30)), s, 0.55)
    im.paste(s, (box[0], box[1]))
# затемнение центра, чтобы текст читался
ov = Image.new("L", (W, H), 0)
ImageDraw.Draw(ov).rounded_rectangle((560, 480, 2000, 960), radius=60, fill=235)
ov = ov.filter(ImageFilter.GaussianBlur(60))
im = Image.composite(Image.new("RGB", (W, H), (12, 18, 30)), im, ov)
d = ImageDraw.Draw(im)


def center(text, y, f, fill):
    d.text(((W - d.textlength(text, font=f)) / 2, y), text, font=f, fill=fill)


d.rounded_rectangle((W / 2 - 80, 548, W / 2 + 80, 560), radius=6, fill=(255, 138, 0))
center("Программы для цеха ЧПУ", 585, ImageFont.truetype(F.format("ExtraBold"), 96), (255, 255, 255))
center("бесплатно · без подписок и лицензий", 735, ImageFont.truetype(F.format("Medium"), 52), (170, 182, 202))
center("STEP · DXF · DWG · симулятор УП Fanuc · расчёт зубьев · наладка станков", 815,
       ImageFont.truetype(F.format("SemiBold"), 40), (255, 138, 0))
out = ROOT / "promo" / "youtube_banner_2560x1440.jpg"
im.save(out, quality=90)
print(out, out.stat().st_size // 1024, "КБ")
