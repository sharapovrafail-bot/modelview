"""Рекламный ролик (YouTube Shorts / Instagram Reels — 1080×1920, YouTube — 1920×1080).
Кадры рисуются Pillow, склеиваются ffmpeg. Запуск: python promo/make_promo.py"""
import math
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "docs" / "img"
OUT = ROOT / "promo"
FPS = 30
FONT = "/usr/share/fonts/opentype/inter/Inter-{}.otf"
BG1, BG2 = (12, 18, 30), (24, 34, 54)
ORANGE = (255, 138, 0)
WHITE = (255, 255, 255)
MUTED = (160, 172, 192)

SCENES = [
    # (секунд, картинка, заголовок, подзаголовок)
    (3.2, None, "Бесплатные программы\nдля цеха ЧПУ", "без подписок, лицензий и облаков"),
    (5.0, "rafcadview.png", "RafCAD View", "STEP · STL · DXF · DWG\nоткрываются за секунды"),
    (5.0, "stz-simulyator.png", "Симулятор УП Fanuc", "проверка программы до станка\nKVL 1000 · PUMA 3050"),
    (4.2, "stz-raschet.png", "STZ Расчёт зубьев", "зубчатые, червячные, цепные\nпередачи по ГОСТ"),
    (4.2, "stz-5k32a.png", "Наладка 5К32А", "гитары, фреза, режимы\nи карта наладки"),
    (4.2, "stz-wirecut.jpg", "STZ WireCut", "программы для\nэлектроэрозии"),
    (3.6, "raflink.png", "RafLink", "файлы телефон ↔ ПК\nпо Wi-Fi"),
    (4.6, None, "Скачать бесплатно", "github.com/sharapovrafail-bot\nРафаил Шарапов · rafail@sharapov-cnc.ru"),
]
FADE = 0.45


def font(w, size):
    return ImageFont.truetype(FONT.format(w), size)


def background(W, H, t):
    im = Image.new("RGB", (W, H), BG1)
    d = ImageDraw.Draw(im)
    for y in range(0, H, 4):
        k = y / H
        d.rectangle((0, y, W, y + 4), fill=tuple(int(BG1[i] + (BG2[i] - BG1[i]) * k) for i in range(3)))
    # чертёжная сетка, медленно плывёт
    step = 60
    off = int(t * 12) % step
    for x in range(-step, W + step, step):
        d.line((x + off, 0, x + off, H), fill=(32, 44, 66), width=1)
    for y in range(-step, H + step, step):
        d.line((0, y + off, W, y + off), fill=(32, 44, 66), width=1)
    return im


def shot(path, max_w, max_h, zoom):
    s = Image.open(IMG / path).convert("RGB")
    k = min(max_w / s.width, max_h / s.height) * zoom
    s = s.resize((int(s.width * k), int(s.height * k)), Image.LANCZOS)
    mask = Image.new("L", s.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s.width, s.height), radius=max(18, s.width // 45), fill=255)
    return s, mask


def fit(d, lines, weight, size, max_w):
    """Уменьшить шрифт, чтобы самая длинная строка влезла по ширине."""
    while size > 30:
        f = font(weight, size)
        if max(d.textlength(ln, font=f) for ln in lines.split("\n")) <= max_w:
            return f
        size -= 4
    return font(weight, size)


def text_block(d, cx, y, lines, f, fill, spacing=1.18):
    for ln in lines.split("\n"):
        w = d.textlength(ln, font=f)
        d.text((cx - w / 2, y), ln, font=f, fill=fill)
        y += int(f.size * spacing)
    return y


def scene_frame(W, H, idx, t, dur):
    sec, pic, title, sub = SCENES[idx]
    vert = H > W
    im = background(W, H, t + idx * 3)
    d = ImageDraw.Draw(im)
    appear = min(1.0, t / 0.6)
    ease = 1 - (1 - appear) ** 3
    if pic is None:
        # заставка / финал
        fs = 108 if vert else 96
        y = H * (0.36 if vert else 0.30)
        d.rectangle((W / 2 - 60, y - 60, W / 2 + 60, y - 50), fill=ORANGE)
        y = text_block(d, W / 2, y + (1 - ease) * 40, title, fit(d, title, "ExtraBold", fs, W - 120), WHITE)
        text_block(d, W / 2, y + 40, sub, fit(d, sub, "Medium", 46 if vert else 42, W - 100), MUTED)
        if idx == len(SCENES) - 1:
            pulse = 1 + 0.04 * math.sin(t * 5)
            bw, bh = int(560 * pulse), int(110 * pulse)
            by = H * (0.72 if vert else 0.78)
            d.rounded_rectangle((W / 2 - bw / 2, by - bh / 2, W / 2 + bw / 2, by + bh / 2), radius=bh // 2, fill=ORANGE)
            text_block(d, W / 2, by - 30, "поставьте звезду", font("Bold", 44), WHITE)
        return im
    # экран программы с медленным приближением
    zoom = 1.0 + 0.06 * (t / dur)
    if vert:
        # на вертикальном экране — крупно: окно программы по высоте, медленная панорама слева направо
        full = Image.open(IMG / pic).convert("RGB")
        hh = int(H * 0.50 * zoom)
        k = hh / full.height
        big = full.resize((int(full.width * k), hh), Image.LANCZOS)
        ww = W - 80
        if big.width > ww:
            x = int((big.width - ww) * min(1.0, t / max(dur - FADE, 0.1)))
            big = big.crop((x, 0, x + ww, hh))
        s = big
        m = Image.new("L", s.size, 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, s.width, s.height), radius=28, fill=255)
        sx, sy = (W - s.width) // 2, int(H * 0.38 + (1 - ease) * 80)
    else:
        s, m = shot(pic, W * 0.60, H - 140, zoom)
        sx, sy = int(W * 0.37 + (1 - ease) * 80), (H - s.height) // 2
    sh = Image.new("RGBA", (s.width + 80, s.height + 80), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle((40, 50, s.width + 40, s.height + 50), radius=30, fill=(0, 0, 0, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(22))
    im.paste(sh, (sx - 40, sy - 40), sh)
    im.paste(s, (sx, sy), m)
    if vert:
        y = int(H * 0.11)
        d.rounded_rectangle((W / 2 - 70, y - 40, W / 2 + 70, y - 30), radius=5, fill=ORANGE)
        y = text_block(d, W / 2, y + (1 - ease) * 30, title, fit(d, title, "ExtraBold", 92, W - 100), WHITE)
        text_block(d, W / 2, y + 26, sub, fit(d, sub, "Medium", 48, W - 100), MUTED)
    else:
        x0 = 90
        y = int(H * 0.34)
        d.rounded_rectangle((x0, y - 40, x0 + 120, y - 30), radius=5, fill=ORANGE)
        for ln in title.split("\n"):
            d.text((x0, y + (1 - ease) * 30), ln, font=font("ExtraBold", 76), fill=WHITE)
            y += 92
        y += 20
        for ln in sub.split("\n"):
            d.text((x0, y), ln, font=font("Medium", 40), fill=MUTED)
            y += 52
    # подпись автора внизу
    f = font("SemiBold", 30)
    tag = "бесплатно · github.com/sharapovrafail-bot"
    d.text((W / 2 - d.textlength(tag, font=f) / 2, H - 70), tag, font=f, fill=(120, 132, 152))
    return im


def render(W, H, name):
    total = sum(s[0] for s in SCENES)
    out = OUT / name
    ff = subprocess.Popen(["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                           "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
                           "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)], stdin=subprocess.PIPE)
    starts, acc = [], 0.0
    for s in SCENES:
        starts.append(acc)
        acc += s[0]
    for n in range(int(total * FPS)):
        tt = n / FPS
        i = max(k for k in range(len(SCENES)) if starts[k] <= tt)
        t, dur = tt - starts[i], SCENES[i][0]
        fr = scene_frame(W, H, i, t, dur)
        if i + 1 < len(SCENES) and dur - t < FADE:            # плавный переход в следующую сцену
            nxt = scene_frame(W, H, i + 1, 0, SCENES[i + 1][0])
            fr = Image.blend(fr, nxt, 1 - (dur - t) / FADE)
        if tt < 0.4:
            fr = Image.blend(Image.new("RGB", (W, H), BG1), fr, tt / 0.4)
        ff.stdin.write(fr.tobytes())
    ff.stdin.close()
    ff.wait()
    print("готово:", out, f"{total:.1f} с")


if __name__ == "__main__":
    which = sys.argv[1:] or ["vertical", "horizontal"]
    if "vertical" in which:
        render(1080, 1920, "promo_shorts_reels_1080x1920.mp4")
    if "horizontal" in which:
        render(1920, 1080, "promo_youtube_1920x1080.mp4")
