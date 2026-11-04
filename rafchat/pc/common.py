"""Общие части оформления (как в RafLink): палитра iOS, значки, стили, карточки, кнопки."""
from __future__ import annotations

import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from PySide6.QtCore import QByteArray, QRectF, QSize, Qt, QUrl
from PySide6.QtGui import QColor, QDesktopServices, QFont, QIcon, QPainter, QPainterPath, QPen, QPixmap
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import QFrame, QHBoxLayout, QLabel, QPushButton, QVBoxLayout, QWidget

IS_WIN = sys.platform == "win32"

PALETTES = {
    # светлая — как iOS (основная)
    "light": dict(bg="#F2F2F7", surface="#FFFFFF", sub="#EEEEF3", tile="#F7F7FA", hover="#F2F2F7",
                  text="#1C1C1E", muted="#8A8A8E", accent="#007AFF", ok="#34C759", warn="#FF9500",
                  err="#FF3B30", line="#E5E5EA", wash="#E7F0FF", on_accent="#FFFFFF", veil="rgba(234,242,255,0.96)"),
    "dark": dict(bg="#000000", surface="#1C1C1E", sub="#2C2C2E", tile="#2C2C2E", hover="#2C2C2E",
                 text="#F2F2F7", muted="#8E8E93", accent="#0A84FF", ok="#30D158", warn="#FF9F0A",
                 err="#FF453A", line="#38383A", wash="#0B2A4A", on_accent="#FFFFFF", veil="rgba(8,30,56,0.96)"),
}
# цвета значков по типу файла (как в макете)
TYPE_STYLE = {
    "cad": ("#AF52DE", "cube"), "mesh": ("#FF9500", "layers"), "draw": ("#30B0C7", "ruler"),
    "code": ("#34C759", "mill"), "image": ("#32ADE6", "image"), "video": ("#FF2D55", "play"),
    "pdf": ("#FF3B30", "doc"), "archive": ("#8E8E93", "archive"), "file": ("#8E8E93", "file"),
}
P = dict(PALETTES["light"])

PATHS = {
    "link": "M9 15l6-6 M7 13l-1 1a3.5 3.5 0 005 5l3-3 M17 11l1-1a3.5 3.5 0 00-5-5l-3 3",
    "cube": "M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10",
    "code": "M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 4l-4 16",
    "folder": "M2 7V5h8l3 3h9v12H2z",
    "down": "M12 2v13m-5-5 5 5 5-5 M4 16v5h16v-5",
    "cam": "M2 7h5l2-3h6l2 3h5v13H2z M16 13a4 4 0 11-8 0 4 4 0 018 0",
    "file": "M5 2h9l5 5v15H5z M14 2v6h5 M8 13h8m-8 4h6",
    "send": "M2 10l20-8-6 20-4-9z M12 13L22 2",
    "chat": "M3 3h18v14H9l-6 4z",
    "wifi": "M2 8q10-9 20 0 M5 12q7-7 14 0 M9 16q3-3 6 0 M12 20h.01",
    "battery": "M2 6h17v12H2z M22 10v4 M5 9h10v6H5z",
    "phone": "M7 2h10a1 1 0 011 1v18H6V3z M11 18h2",
    "pc": "M2 3h20v14H2z M12 17v4 M7 21h10",
    "sun": "M16 12a4 4 0 11-8 0 4 4 0 018 0 M12 1v3m0 16v3 M1 12h3m16 0h3 M4 4l2 2m12 12 2 2 M4 20l2-2M18 6l2-2",
    "gear": "M3 6h18M3 12h18M3 18h18 M8 3v6m9 0v6m-9 0v6",
    "list": "M3 5h18 M3 12h18 M3 19h18",
    "tiles": "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    "refresh": "M20 11a8 8 0 10-2.3 5.7 M20 4v7h-7",
    "up": "M12 19V5 M5 12l7-7 7 7",
    "mini": "M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7",
    "doc": "M6 2h12v20H6z M9 7h6 M9 11h6 M9 15h4",
    "shot": "M3 7V3h4 M17 3h4v4 M21 17v4h-4 M7 21H3v-4",
    "back": "M15 4l-8 8 8 8",
    "chev": "M9 5l7 7-7 7",
    "layers": "M12 3l9 5-9 5-9-5z M3 12.5l9 5 9-5 M3 16.5l9 5 9-5",
    "mill": "M9 2h6v5H9z M10 7h4v7l-2 4-2-4z M10 9.5l4 2 M10 12l4 2 M5 21h14",
    "image": "M3 4h18v16H3z M3 16l5-5 5 5 3-3 5 5 M16.5 8.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0",
    "play": "M8 5v14l11-7z",
    "archive": "M4 4h16v4H4z M5 8h14v12H5z M10 12h4",
    "ruler": "M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2",
    "search": "M10.5 18a7.5 7.5 0 110-15 7.5 7.5 0 010 15z M16 16l5 5",
    "open": "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
    "check": "M5 12.5l4.5 4.5L19 7",
    "sort": "M4 6h16 M7 12h10 M10 18h4",
    "bubble": "M4 5h16v11H10l-5 4v-4H4z M8 10.5h.01 M12 10.5h.01 M16 10.5h.01",
    "attach": "M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7",
    "users": "M9 11a4 4 0 100-8 4 4 0 000 8z M2 21v-1a6 6 0 0112 0v1 M16 3.5a4 4 0 010 7.5 M22 21v-1a6 6 0 00-4-5.6",
    "clock": "M12 21a9 9 0 110-18 9 9 0 010 18z M12 7v5l3 2",
    "clip": "M8 5H5v16h14V5h-3 M8 3h8v4H8z M9 12h6 M9 16h4",
    "lock": "M6 11h12v10H6z M8 11V7a4 4 0 018 0v4",
    "home": "M3 11l9-8 9 8 M5 9v12h14V9",
    "recents": "M5 5h14v14H5z",
    "bell": "M4 17h16l-2-4V9a6 6 0 00-12 0v4z M10 20h4",
    "power": "M12 3v9 M6.3 6.3a8 8 0 1011.4 0",
    "screen": "M7 2h10a1 1 0 011 1v18H6V3z M9 6h6v9H9z",
    "gallery": "M3 3h18v18H3z M3 16l5-5 4 4 3-3 6 6 M15.5 8.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0",
}

_glyph_cache: dict = {}


def glyph(name: str, color: str, size: int = 20, width: float = 1.7) -> QPixmap:
    key = (name, color, size, width)
    if key in _glyph_cache:
        return _glyph_cache[key]
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="{color}" '
           f'stroke-width="{width}" stroke-linecap="round" stroke-linejoin="round"><path d="{PATHS[name]}"/></svg>')
    r = QSvgRenderer(QByteArray(svg.encode()))
    pm = QPixmap(size * 2, size * 2)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    r.render(p)
    p.end()
    pm.setDevicePixelRatio(2)
    _glyph_cache[key] = pm
    return pm


def app_icon_pixmap(size=256) -> QPixmap:
    pm = QPixmap(size, size)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    from PySide6.QtGui import QLinearGradient
    g = QLinearGradient(0, 0, 0, size)
    g.setColorAt(0, QColor("#3D9BFF"))
    g.setColorAt(1, QColor("#0062E0"))
    p.setBrush(g)
    p.setPen(Qt.NoPen)
    p.drawRoundedRect(QRectF(0, 0, size, size), size * 0.23, size * 0.23)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" '
           f'stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="{PATHS["bubble"]}"/></svg>')
    QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(size * .16, size * .16, size * .68, size * .68))
    p.end()
    return pm


def qss() -> str:
    return f"""
    QWidget {{ color: {P['text']}; font-size: 15px; }}
    QMainWindow, QDialog, QWidget#root {{ background: {P['bg']}; }}
    QWidget#page, QScrollArea, QScrollArea > QWidget > QWidget#chips {{ background: transparent; }}
    QLabel {{ background: transparent; }}
    QLabel#muted, QLabel#small {{ color: {P['muted']}; }}
    QLabel#small {{ font-size: 13px; }}
    QLabel#label {{ color: {P['muted']}; font-size: 13px; font-weight: 600; }}
    QLabel#h1 {{ font-size: 30px; font-weight: 700; }}
    QLabel#h2 {{ font-size: 22px; font-weight: 700; }}
    QLabel#h3 {{ font-size: 17px; font-weight: 650; }}
    QLabel#devname {{ font-size: 21px; font-weight: 700; }}
    QLabel#err {{ color: {P['err']}; }}
    QLabel#accent {{ color: {P['accent']}; }}
    QLabel#veiltext {{ color: {P['accent']}; font-size: 28px; font-weight: 700; }}
    QFrame#card {{ background: {P['surface']}; border-radius: 16px; }}
    QFrame#iconbox {{ background: {P['wash']}; border-radius: 14px; }}
    QFrame#segtrack {{ background: {P['sub']}; border-radius: 12px; }}
    QFrame#note {{ background: {P['surface']}; border-radius: 14px; }}
    QFrame#banner {{ background: {P['wash']}; border: 1px solid {P['accent']}; border-radius: 14px; }}
    QFrame#toast {{ background: {P['surface']}; border-radius: 16px; }}
    QFrame#veil {{ background: {P['veil']}; border: 2px solid {P['accent']}; border-radius: 18px; }}
    QFrame#capsule {{ background: {P['surface']}; border: 1px solid {P['line']}; border-radius: 28px; }}
    QFrame#sep {{ background: {P['line']}; max-height: 1px; min-height: 1px; border: 0; }}
    QPushButton {{ background: {P['sub']}; border: 0; border-radius: 12px; min-height: 40px; padding: 6px 14px;
                   color: {P['accent']}; font-weight: 600; }}
    QPushButton:hover {{ background: {P['wash']}; }}
    QPushButton:focus {{ outline: none; }}
    QPushButton:disabled {{ color: {P['muted']}; }}
    QPushButton#primary {{ background: {P['accent']}; color: {P['on_accent']}; min-height: 46px; font-size: 16px; }}
    QPushButton#primary:hover {{ background: {P['accent']}; }}
    QPushButton#primary:disabled {{ background: {P['line']}; color: {P['muted']}; }}
    QPushButton#tinted {{ background: {P['wash']}; color: {P['accent']}; min-height: 46px; font-size: 16px; }}
    QPushButton#tinted:disabled {{ background: {P['sub']}; color: {P['muted']}; }}
    QPushButton#icon {{ background: transparent; border: 0; min-height: 34px; min-width: 34px; padding: 4px; }}
    QPushButton#icon:hover {{ background: {P['sub']}; }}
    QPushButton#link {{ background: transparent; min-height: 30px; padding: 2px 4px; }}
    QPushButton#seg {{ background: transparent; border: 0; border-radius: 10px; color: {P['text']};
                       font-weight: 500; font-size: 16px; min-height: 40px; }}
    QPushButton#seg:hover {{ background: {P['line']}; }}
    QPushButton#seg:checked {{ background: {P['accent']}; color: {P['on_accent']}; font-weight: 650; }}
    QPushButton#quick {{ background: {P['tile']}; border: 1px solid {P['line']}; border-radius: 14px;
                         color: {P['text']}; font-weight: 650; font-size: 15px; min-height: 46px;
                         text-align: left; padding-left: 12px; }}
    QPushButton#quick:hover {{ border-color: {P['accent']}; }}
    QPushButton#quick:checked {{ background: {P['wash']}; border-color: {P['accent']}; }}
    QPushButton#chip {{ background: transparent; border-radius: 10px; color: {P['text']}; font-weight: 500;
                        min-height: 38px; padding: 4px 14px; }}
    QPushButton#chip:checked {{ background: {P['wash']}; color: {P['accent']}; }}
    QPushButton#crumb {{ background: transparent; border: 0; padding: 2px 3px; min-height: 28px;
                         color: {P['accent']}; font-weight: 500; font-size: 16px; }}
    QPushButton#crumblast {{ background: transparent; border: 0; padding: 2px 3px; min-height: 28px;
                             color: {P['text']}; font-weight: 650; font-size: 16px; }}
    QLineEdit, QComboBox {{ background: {P['sub']}; border: 0; border-radius: 11px; padding: 8px 10px;
                            min-height: 22px; }}
    QLineEdit:focus, QComboBox:focus {{ border: 2px solid {P['accent']}; }}
    QLineEdit#search {{ font-size: 16px; padding-left: 4px; }}
    QLineEdit#digit {{ background: {P['surface']}; border: 1px solid {P['line']}; border-radius: 12px;
                       font-size: 30px; padding: 0; }}
    QLineEdit#digit:focus {{ border: 2px solid {P['accent']}; }}
    QComboBox QAbstractItemView {{ background: {P['surface']}; border: 1px solid {P['line']};
                                   selection-background-color: {P['wash']}; }}
    QListWidget {{ background: transparent; border: 0; outline: 0; }}
    QListWidget::item:selected, QListWidget::item:hover {{ background: transparent; }}
    QProgressBar {{ background: {P['line']}; border: 0; border-radius: 3px; max-height: 6px; }}
    QProgressBar::chunk {{ background: {P['accent']}; border-radius: 3px; }}
    QScrollBar:vertical {{ background: transparent; width: 8px; margin: 2px; }}
    QScrollBar::handle:vertical {{ background: {P['line']}; border-radius: 3px; min-height: 30px; }}
    QScrollBar:horizontal {{ height: 0; }}
    QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
    QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}
    QMenu {{ background: {P['surface']}; border: 1px solid {P['line']}; border-radius: 10px; padding: 5px; }}
    QMenu::item {{ padding: 8px 24px; border-radius: 7px; }}
    QMenu::item:selected {{ background: {P['wash']}; color: {P['text']}; }}
    QMenu::separator {{ height: 1px; background: {P['line']}; margin: 4px 8px; }}
    QCheckBox {{ spacing: 10px; }}
    QToolTip {{ background: {P['surface']}; color: {P['text']}; border: 1px solid {P['line']}; }}
    """


def card(parent_layout=None, margins=(14, 12, 14, 12), spacing=8, horizontal=False):
    """Белая карточка со скруглением (как группа в «Настройках» iOS)."""
    f = QFrame()
    f.setObjectName("card")
    lay = (QHBoxLayout if horizontal else QVBoxLayout)(f)
    lay.setContentsMargins(*margins)
    lay.setSpacing(spacing)
    if parent_layout is not None:
        parent_layout.addWidget(f)
    return f, lay


def sep_line() -> QFrame:
    f = QFrame()
    f.setObjectName("sep")
    return f


class Battery(QWidget):
    def __init__(self):
        super().__init__()
        self.level = -1
        self.charging = False
        self.setFixedSize(34, 18)

    def set(self, level, charging):
        self.level, self.charging = level, charging
        self.update()

    def paintEvent(self, ev):
        if self.level < 0:
            return
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing)
        p.setPen(QPen(QColor(P["muted"]), 1.4))
        p.setBrush(Qt.NoBrush)
        p.drawRoundedRect(QRectF(1, 2, 28, 14), 4, 4)
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(P["muted"]))
        p.drawRoundedRect(QRectF(30.5, 7, 2.5, 4), 1, 1)
        color = P["ok"] if self.level > 20 or self.charging else P["err"]
        p.setBrush(QColor(color))
        p.drawRoundedRect(QRectF(3, 4, 24 * max(self.level, 4) / 100, 10), 2.5, 2.5)
        p.end()

def label(text="", name=None, wrap=False) -> QLabel:
    lb = QLabel(text)
    if name:
        lb.setObjectName(name)
    if name == "label":
        f = lb.font()
        f.setLetterSpacing(QFont.AbsoluteSpacing, 1.4)
        lb.setFont(f)
        lb.setText(text.upper())
    lb.setWordWrap(wrap)
    return lb


def button(text="", name=None, icon=None, tip=None, fn=None, color=None) -> QPushButton:
    b = QPushButton(text)
    if name:
        b.setObjectName(name)
    if icon:
        b.setIcon(QIcon(glyph(icon, color or P["accent"])))
        b.setIconSize(QSize(20, 20))
    if tip:
        b.setToolTip(tip)
    if fn:
        b.clicked.connect(fn)
    b.setCursor(Qt.PointingHandCursor)
    return b


def icon_box(name: str, color: str, size=40) -> QFrame:
    f = QFrame()
    f.setObjectName("iconbox")
    f.setFixedSize(size, size + 3)
    lay = QVBoxLayout(f)
    lay.setContentsMargins(0, 0, 0, 0)
    lb = QLabel()
    lb.setPixmap(glyph(name, color, 22))
    lb.setAlignment(Qt.AlignCenter)
    lay.addWidget(lb)
    return f


# ---------------------------------------------------------------- вспомогательное

CAD_EXT = {"step", "stp", "stl", "3mf", "dxf", "dwg", "igs", "iges", "obj", "brep", "f3d", "sldprt", "sldasm"}
NC_EXT = {"nc", "tap", "cnc", "ngc", "gcode", "mpf", "eia", "h"}
IMG_EXT = {"jpg", "jpeg", "png", "webp", "heic", "heif", "bmp", "gif"}
VID_EXT = {"mp4", "mov", "3gp", "mkv", "webm"}
ARC_EXT = {"zip", "rar", "7z", "tar", "gz"}


# Как папки и альбомы называются на телефоне Xiaomi (Проводник / Галерея).
FOLDER_RU = {
    "Download": "Загрузки", "Documents": "Документы", "Pictures": "Изображения", "Music": "Музыка",
    "Movies": "Видео", "DCIM": "Фото с камеры (DCIM)", "Camera": "Камера", "Screenshots": "Скриншоты",
    "Ringtones": "Рингтоны", "Notifications": "Звуки уведомлений", "Alarms": "Будильники",
    "Podcasts": "Подкасты", "Audiobooks": "Аудиокниги", "Recordings": "Записи", "Recorder": "Диктофон",
    "ScreenRecorder": "Записи экрана", "Screen recordings": "Записи экрана", "Bluetooth": "Bluetooth",
    "Android": "Android (системная)", "MIUI": "MIUI (системная)", "WhatsApp Images": "WhatsApp",
    "WhatsApp Video": "WhatsApp видео", "Telegram Images": "Telegram", "Telegram Video": "Telegram видео",
    "Telegram": "Telegram", "Restored": "Восстановленные", "Edited": "Изменённые",
}


def ru_name(name: str) -> str:
    return FOLDER_RU.get(name, name)


def disp_name(e: dict) -> str:
    return ru_name(e["name"]) if e.get("dir") else e["name"]


def ext_of(name: str) -> str:
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def kind_of(e: dict) -> str:
    if e.get("dir"):
        return "dir"
    x = ext_of(e["name"])
    if x in NC_EXT:
        return "code"
    if x in CAD_EXT:
        return "cube"
    if x in IMG_EXT or x in VID_EXT:
        return "cam"
    if x in ARC_EXT:
        return "folder"
    return "file"


def type_of(e: dict) -> str:
    x = ext_of(e["name"])
    if x in NC_EXT:
        return "code"
    if x in {"step", "stp", "igs", "iges", "brep", "f3d", "sldprt", "sldasm"}:
        return "cad"
    if x in {"stl", "3mf", "obj"}:
        return "mesh"
    if x in {"dxf", "dwg"}:
        return "draw"
    if x in IMG_EXT:
        return "image"
    if x in VID_EXT:
        return "video"
    if x == "pdf":
        return "pdf"
    if x in ARC_EXT:
        return "archive"
    return "file"


def short_when(ts: float) -> str:
    d = datetime.fromtimestamp(ts or 0)
    now = datetime.now()
    if d.date() == now.date():
        return "сегодня " + d.strftime("%H:%M")
    if (now.date() - d.date()).days == 1:
        return "вчера " + d.strftime("%H:%M")
    return d.strftime("%d.%m.%Y")


_type_icon_cache: dict = {}


def type_icon(e: dict, w=40) -> QPixmap:
    """Значок файла как в iOS «Файлы»: цветной лист с загнутым уголком; папка — синяя."""
    key = ("dir" if e.get("dir") else type_of(e), w, P["accent"])
    if key in _type_icon_cache:
        return _type_icon_cache[key]
    h = int(w * 1.15)
    pm = QPixmap(w * 2, h * 2)
    pm.setDevicePixelRatio(2)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    if e.get("dir"):
        top = h * 0.22
        p.setPen(Qt.NoPen)
        p.setBrush(QColor("#5AA2F8"))
        tab = QPainterPath()
        tab.addRoundedRect(QRectF(1, top - 4, w * 0.45, 12), 3, 3)
        p.drawPath(tab)
        body = QPainterPath()
        body.addRoundedRect(QRectF(1, top + 2, w - 2, h * 0.62), 5, 5)
        p.setBrush(QColor("#74B3FA"))
        p.drawPath(body)
    else:
        color, g = TYPE_STYLE[type_of(e)]
        fold = w * 0.3
        path = QPainterPath()
        r = 7
        path.moveTo(r, 0)
        path.lineTo(w - fold, 0)
        path.lineTo(w, fold)
        path.lineTo(w, h - r)
        path.quadTo(w, h, w - r, h)
        path.lineTo(r, h)
        path.quadTo(0, h, 0, h - r)
        path.lineTo(0, r)
        path.quadTo(0, 0, r, 0)
        p.fillPath(path, QColor(color))
        corner = QPainterPath()
        corner.moveTo(w - fold, 0)
        corner.lineTo(w - fold, fold * 0.8)
        corner.quadTo(w - fold, fold, w - fold * 0.8, fold)
        corner.lineTo(w, fold)
        corner.closeSubpath()
        p.fillPath(corner, QColor(255, 255, 255, 110))
        gs = int(w * 0.5)
        p.drawPixmap(QRectF((w - gs) / 2, h * 0.58 - gs / 2, gs, gs).toRect(), glyph(g, "#FFFFFF", gs, 2.0))
    p.end()
    _type_icon_cache[key] = pm
    return pm


def has_thumb(e: dict) -> bool:
    return not e.get("dir") and ext_of(e["name"]) in IMG_EXT | VID_EXT


def human(n: float) -> str:
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if n < 1024 or unit == "ГБ":
            s = f"{n:.0f}" if unit == "Б" or n >= 100 else f"{n:.1f}"
            return s.replace(".", ",") + " " + unit
        n /= 1024
    return str(n)


def when(ts: float) -> str:
    d = datetime.fromtimestamp(ts)
    now = datetime.now()
    if d.date() == now.date():
        return "Сегодня, " + d.strftime("%H:%M")
    if (now.date() - d.date()).days == 1:
        return "Вчера, " + d.strftime("%H:%M")
    return d.strftime("%d.%m.%Y %H:%M")


def clean_name(name: str) -> str:
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r'[\x00-\x1f<>:"|?*]', "_", name).strip().lstrip(".")
    return (name or "file")[:180]


def unique_path(folder: Path, name: str) -> Path:
    p = folder / name
    if not p.exists():
        return p
    stem, suf = os.path.splitext(name)
    i = 2
    while (folder / f"{stem} ({i}){suf}").exists():
        i += 1
    return folder / f"{stem} ({i}){suf}"


def open_local(path: Path):
    if IS_WIN:
        os.startfile(str(path))  # noqa
    else:
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(path)))


def show_in_folder(path: Path):
    if IS_WIN and path.exists():
        subprocess.Popen(["explorer", "/select,", str(path)])
    else:
        QDesktopServices.openUrl(QUrl.fromLocalFile(str(path.parent if path.is_file() else path)))


