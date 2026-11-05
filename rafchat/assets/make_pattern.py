"""Узор фона чата (как «обои» WhatsApp, но из чертёжных мотивов): шестерни, гайки, штангенциркуль, сверло,
размерные линии. Выдаёт chat_pattern.svg (для ПК) и chat_pattern.png (для Android/iPhone)."""
import math
import sys
from pathlib import Path

W = H = 480
C = "#9AA3AF"     # цвет линий; на экране узор полупрозрачный


def gear(cx, cy, r, teeth, rot=0.0, hole=0.35):
    pts = []
    tooth = r * 0.16
    for i in range(teeth * 4):
        a = rot + i * math.pi * 2 / (teeth * 4)
        rr = r + (tooth if i % 4 in (1, 2) else 0)
        pts.append(f"{cx + rr * math.cos(a):.1f},{cy + rr * math.sin(a):.1f}")
    s = f'<polygon points="{" ".join(pts)}"/>'
    s += f'<circle cx="{cx}" cy="{cy}" r="{r * hole:.1f}"/>'
    s += f'<path d="M{cx - r * hole * 0.35:.1f},{cy - r * hole:.1f}h{r * hole * 0.7:.1f}"/>'   # шпоночный паз
    return s


def nut(cx, cy, r, rot=0.0):
    pts = " ".join(f"{cx + r * math.cos(rot + k * math.pi / 3):.1f},{cy + r * math.sin(rot + k * math.pi / 3):.1f}"
                   for k in range(6))
    return f'<polygon points="{pts}"/><circle cx="{cx}" cy="{cy}" r="{r * 0.55:.1f}"/>'


def center_mark(cx, cy, r):
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}"/><path d="M{cx - r - 6},{cy}h{2 * r + 12}M{cx},{cy - r - 6}v{2 * r + 12}"'
            f' stroke-dasharray="6 3 1 3"/>')


def dim_h(x1, x2, y, text):
    a = 6
    return (f'<path d="M{x1},{y - 10}v20M{x2},{y - 10}v20M{x1},{y}H{x2}"/>'
            f'<path d="M{x1},{y}l{a},-3v6zM{x2},{y}l-{a},-3v6z" fill="{C}"/>'
            f'<text x="{(x1 + x2) / 2}" y="{y - 5}" text-anchor="middle">{text}</text>')


def caliper(x, y):
    return (f'<g transform="translate({x},{y}) rotate(-20)">'
            f'<rect x="0" y="0" width="150" height="14" rx="2"/>'
            + "".join(f'<path d="M{10 + i * 10},0v{5 if i % 5 else 9}"/>' for i in range(14)) +
            f'<path d="M0,14v34h10v-34M44,14v26h10v-26"/><rect x="40" y="-4" width="28" height="22" rx="3"/></g>')


def drill(x, y):
    return (f'<g transform="translate({x},{y}) rotate(35)"><rect x="0" y="0" width="16" height="40" rx="2"/>'
            f'<path d="M0,40h16l0,60l-8,14l-8,-14z"/>'
            + "".join(f'<path d="M0,{48 + i * 12}l16,8"/>' for i in range(5)) + '</g>')


def wrench(x, y):
    return (f'<g transform="translate({x},{y}) rotate(-35)"><path d="M0,0h110"/><path d="M0,10h110"/>'
            f'<path d="M110,-6a14,14 0 1,1 0,22M110,-6l8,8M110,16l8,-8"/><circle cx="-6" cy="5" r="11"/></g>')


def build():
    els = [
        gear(80, 90, 42, 14, 0.1), gear(140, 150, 26, 10, 0.3), gear(390, 360, 50, 16, 0.2),
        nut(330, 80, 22, 0.2), nut(450, 205, 14), nut(330, 452, 14, 0.4),
        center_mark(268, 372, 18), center_mark(205, 120, 10),
        dim_h(250, 370, 175, "Ø32 h6"), dim_h(30, 150, 445, "120±0,05"),
        caliper(170, 250), drill(70, 180), wrench(40, 360),
        '<text x="330" y="140">Ra 1,6</text>', '<text x="205" y="62">M8</text>', '<text x="440" y="270">45°</text>',
        '<text x="160" y="352">R5</text>', '<text x="380" y="40">G54</text>', '<text x="428" y="140">IT7</text>',
        '<path d="M206,452l14,-24l14,24z"/>',          # знак шероховатости
    ]
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
            f'<g fill="none" stroke="{C}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
            f'font-family="Consolas, monospace" font-size="15">'
            + "".join(els).replace("<text ", f'<text fill="{C}" stroke="none" ') + "</g></svg>")


if __name__ == "__main__":
    here = Path(__file__).parent
    svg = build()
    (here / "chat_pattern.svg").write_text(svg, "utf-8")
    from PySide6.QtCore import QByteArray, QRectF, Qt
    from PySide6.QtGui import QGuiApplication, QImage, QPainter
    from PySide6.QtSvg import QSvgRenderer
    app = QGuiApplication(sys.argv)
    img = QImage(W, H, QImage.Format_ARGB32)
    img.fill(Qt.transparent)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing)
    QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(0, 0, W, H))
    p.end()
    img.save(str(here / "chat_pattern.png"))
    print("ok", W, H)
