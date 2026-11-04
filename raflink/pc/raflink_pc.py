"""RafLink для Windows: окно телефона на ПК, перетаскивание файлов в обе стороны.

Телефон (приложение RafLink на Android) держит HTTP-сервер на порту 47700.
ПК подключается к нему по 6-значному коду, смотрит папки, скачивает и отправляет файлы.
Файлы «с телефона на ПК» телефон ставит в очередь, а ПК забирает их при опросе (брандмауэр не мешает).
"""
from __future__ import annotations

import hashlib
import http.client
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, urlencode

from PySide6.QtCore import (QByteArray, QEventLoop, QMimeData, QObject, QPoint,
                            QRectF, QSize, Qt, QTimer, QUrl, Signal)
from PySide6.QtGui import (QColor, QDesktopServices, QDrag, QFont, QFontMetrics, QIcon,
                           QPainter, QPainterPath, QPen, QPixmap)
from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtSvg import QSvgRenderer
from PySide6.QtWidgets import (QAbstractItemView, QApplication, QCheckBox, QComboBox, QDialog,
                               QFileDialog, QFrame, QGridLayout, QHBoxLayout, QLabel, QLineEdit,
                               QListWidget, QListWidgetItem, QMainWindow, QMenu, QMessageBox,
                               QProgressBar, QPushButton, QScrollArea, QStackedWidget, QStyle,
                               QStyledItemDelegate, QSystemTrayIcon, QVBoxLayout, QWidget)

APP_VER = "0.3.2"
APP_AUTHOR = "Рафаил Шарапов"
APP_EMAIL = "rafail@sharapov-cnc.ru"
APP_COPYRIGHT = "© 2026 Рафаил Шарапов"
PHONE_PORT = 47700
IS_WIN = sys.platform == "win32"

CONFIG_DIR = Path(os.environ.get("APPDATA") or Path.home() / ".config") / "RafLink"
CONFIG_FILE = CONFIG_DIR / "config.json"
CACHE_DIR = Path(os.environ.get("TEMP") or "/tmp") / "RafLink" / "cache"
PHONE_ROOT = "/storage/emulated/0"

# ---------------------------------------------------------------- оформление (из прототипа)

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
           f'stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="{PATHS["link"]}"/></svg>')
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


def default_inbox() -> str:
    return str(Path.home() / "Downloads" / "RafLink")


# ---------------------------------------------------------------- настройки

class Config:
    def __init__(self):
        self.data = {"phone": None, "inbox": default_inbox(), "theme": "light", "history": [],
                     "hint_tray": False}
        try:
            self.data.update(json.loads(CONFIG_FILE.read_text("utf-8")))
        except Exception:
            pass
        if self.data.get("ui") != 3:
            self.data["ui"] = 3
            self.data["theme"] = "light"

    def __getitem__(self, k):
        return self.data.get(k)

    def __setitem__(self, k, v):
        self.data[k] = v
        self.save()

    def save(self):
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            tmp = CONFIG_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=1), "utf-8")
            tmp.replace(CONFIG_FILE)
        except Exception:
            pass

    def inbox(self) -> Path:
        p = Path(self.data.get("inbox") or default_inbox())
        p.mkdir(parents=True, exist_ok=True)
        return p

    def add_history(self, direction: str, name: str, size: int, local: str):
        h = [{"t": time.time(), "dir": direction, "name": name, "size": size, "local": local}]
        self.data["history"] = (h + (self.data.get("history") or []))[:300]
        self.save()


# ---------------------------------------------------------------- связь с телефоном

class Cancelled(Exception):
    pass


class PhoneError(Exception):
    def __init__(self, msg, status=0):
        super().__init__(msg)
        self.status = status


ERRORS = {
    "wrong_pin": "Неверный код. Проверьте код на экране телефона.",
    "not_paired": "Телефон не узнал этот ПК — подключите его заново.",
    "no_permission": "На телефоне не разрешён «Доступ ко всем файлам» для RafLink.",
    "not_found": "Файл или папка не найдены на телефоне.",
    "outside": "Эта папка недоступна.",
}


class PhoneClient:
    def __init__(self, host: str, port: int = PHONE_PORT, token: str | None = None):
        self.host, self.port, self.token = host, port, token

    def _url(self, path, params=None):
        return path + ("?" + urlencode(params, quote_via=quote) if params else "")

    def _headers(self, extra=None):
        h = {"X-Token": self.token} if self.token else {}
        h.update(extra or {})
        return h

    def _open(self, method, path, params=None, body=None, headers=None, timeout=8):
        c = http.client.HTTPConnection(self.host, self.port, timeout=timeout)
        try:
            c.request(method, self._url(path, params), body=body, headers=self._headers(headers))
            return c, c.getresponse()
        except OSError as e:
            c.close()
            raise PhoneError("Нет связи с телефоном") from e

    def _check(self, r, raw: bytes):
        if r.status != 200:
            try:
                code = json.loads(raw).get("error", "")
            except Exception:
                code = ""
            raise PhoneError(ERRORS.get(code, code or f"Ошибка телефона ({r.status})"), r.status)

    def json(self, method, path, params=None, body=None, timeout=8):
        data = json.dumps(body).encode() if body is not None else None
        c, r = self._open(method, path, params, data, {"Content-Type": "application/json"} if data else None,
                          timeout)
        try:
            raw = r.read()
        finally:
            c.close()
        self._check(r, raw)
        return json.loads(raw or b"{}")

    def hello(self):
        return self.json("GET", "/api/hello", timeout=3)

    def pair(self, pin: str):
        return self.json("POST", "/api/pair", body={"pin": pin, "pc_name": socket.gethostname()})

    def info(self):
        return self.json("GET", "/api/info", timeout=4)

    def list(self, path: str):
        return self.json("GET", "/api/list", {"path": path}, timeout=15)

    def albums(self):
        return self.json("GET", "/api/albums", timeout=30)

    def media(self, album: str):
        return self.json("GET", "/api/media", {"album": album}, timeout=30)

    def outbox(self):
        return self.json("GET", "/api/outbox", timeout=8)

    def outbox_done(self, oid: str):
        return self.json("POST", "/api/outbox/done", {"id": oid}, body={}, timeout=8)

    def thumb(self, path: str, size=256) -> bytes:
        c, r = self._open("GET", "/api/thumb", {"path": path, "size": size}, timeout=15)
        try:
            raw = r.read()
        finally:
            c.close()
        self._check(r, raw)
        return raw

    def download(self, path: str, dest: Path, step, log=True, outbox_id=None):
        if outbox_id:
            c, r = self._open("GET", "/api/outbox/file", {"id": outbox_id}, timeout=30)
        else:
            c, r = self._open("GET", "/api/file", {"path": path, "log": "1" if log else "0"}, timeout=30)
        tmp = dest.with_name(dest.name + ".part")
        try:
            if r.status != 200:
                self._check(r, r.read())
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(tmp, "wb") as f:
                while True:
                    chunk = r.read(256 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    step(len(chunk))
            tmp.replace(dest)
        except BaseException:
            try:
                tmp.unlink()
            except OSError:
                pass
            raise
        finally:
            c.close()

    def upload(self, local: Path, step) -> str:
        size = local.stat().st_size
        c = http.client.HTTPConnection(self.host, self.port, timeout=30)
        try:
            c.putrequest("POST", self._url("/api/upload", {"name": local.name}))
            for k, v in self._headers({"Content-Type": "application/octet-stream",
                                       "Content-Length": str(size)}).items():
                c.putheader(k, v)
            c.endheaders()
            with open(local, "rb") as f:
                while True:
                    chunk = f.read(256 * 1024)
                    if not chunk:
                        break
                    c.send(chunk)
                    step(len(chunk))
            r = c.getresponse()
            raw = r.read()
            self._check(r, raw)
            return json.loads(raw).get("name", local.name)
        except OSError as e:
            raise PhoneError("Связь прервалась") from e
        finally:
            c.close()


# ---------------------------------------------------------------- фоновые задачи

class Bridge(QObject):
    """Передаёт результаты из потоков в окно (сигналы Qt безопасны между потоками)."""
    done = Signal(object, object)       # callback, result
    failed = Signal(object, object)     # callback, exception
    found = Signal(str, str, int)       # имя, ip, порт
    show_window = Signal()

    def __init__(self):
        super().__init__()
        self.done.connect(lambda cb, r: cb(r))
        self.failed.connect(lambda cb, e: cb(e))


BRIDGE: Bridge | None = None


def run_bg(fn, ok=None, fail=None):
    def work():
        try:
            r = fn()
            if ok:
                BRIDGE.done.emit(ok, r)
        except Exception as e:  # noqa
            if fail:
                BRIDGE.failed.emit(fail, e)
    threading.Thread(target=work, daemon=True).start()


class Transfers(QObject):
    """Очередь передач: одна активная, остальные ждут."""
    started = Signal(str, str, int)        # направление ('in'/'out'), первый файл, количество
    progress = Signal(int, int, float)     # передано, всего, скорость Б/с
    finished = Signal(str, list, str)      # направление, локальные пути, ошибка ('' — успех)

    def __init__(self, app: "MainWindow"):
        super().__init__()
        self.app = app
        self.queue: list = []
        self.busy = False
        self.cancel_ev = threading.Event()
        self._then = None
        self.finished.connect(self._on_finished)

    def cancel(self):
        self.cancel_ev.set()
        self.queue.clear()

    def download(self, entries: list, dest_dir: Path | None, then=None, kind="in"):
        self.queue.append((kind, entries, dest_dir, then))
        self._next()

    def upload(self, paths: list, then=None):
        self.queue.append(("out", paths, None, then))
        self._next()

    def _next(self):
        if self.busy or not self.queue:
            return
        client = self.app.client
        if client is None:
            self.queue.clear()
            return
        direction, items, dest_dir, then = self.queue.pop(0)
        self.busy = True
        self._then = then
        self.cancel_ev.clear()
        if direction in ("in", "push"):
            first, total = items[0]["name"], sum(int(e.get("size") or 0) for e in items)
        else:
            first, total = items[0].name, sum(p.stat().st_size for p in items)
        self.started.emit(direction, first, len(items))
        threading.Thread(target=self._work, args=(client, direction, items, dest_dir, total), daemon=True).start()

    def _work(self, client, direction, items, dest_dir, total):
        done = 0
        t0 = time.time()
        last = [0.0]
        results = []

        def step(n):
            nonlocal done
            if self.cancel_ev.is_set():
                raise Cancelled()
            done += n
            now = time.time()
            if now - last[0] > 0.12:
                last[0] = now
                self.progress.emit(done, max(total, 1), done / max(now - t0, 0.001))

        try:
            for it in items:
                if direction in ("in", "push"):
                    if dest_dir is None:
                        dest = cache_path(it)
                        if dest.exists() and dest.stat().st_size == int(it.get("size") or -1):
                            done += dest.stat().st_size
                            results.append(dest)
                            continue
                    else:
                        dest = unique_path(dest_dir, clean_name(it["name"]))
                    client.download(it.get("path"), dest, step, log=True, outbox_id=it.get("outbox_id"))
                    if it.get("outbox_id"):
                        client.outbox_done(it["outbox_id"])
                    results.append(dest)
                    self.app.config.add_history("in", it["name"], int(it.get("size") or 0), str(dest))
                else:
                    client.upload(it, step)
                    results.append(it)
                    self.app.config.add_history("out", it.name, it.stat().st_size, str(it))
            self.progress.emit(max(total, 1), max(total, 1), 0)
            self.finished.emit(direction, results, "")
        except Cancelled:
            self.finished.emit(direction, results, "cancel")
        except Exception as e:  # noqa
            self.finished.emit(direction, results, str(e) or "Ошибка передачи")

    def _on_finished(self, direction, results, err):
        self.busy = False
        then, self._then = self._then, None
        if then:
            then(results, err)
        self._next()


def cache_path(e: dict) -> Path:
    h = hashlib.md5(f'{e["path"]}|{e.get("size")}|{e.get("mtime")}'.encode()).hexdigest()[:12]
    return CACHE_DIR / h / clean_name(e["name"])


VIRTUAL_ADAPTERS = ("vpn", "tap", "tun", "wireguard", "wintun", "virtual", "vethernet", "hyper-v", "vmware",
                    "virtualbox", "loopback", "angel", "outline", "openvpn", "zerotier", "tailscale", "radmin",
                    "hamachi", "docker", "wsl")


def lan_ips():
    """IPv4-адреса обычных сетевых адаптеров (Ethernet/Wi-Fi), без VPN и виртуальных."""
    try:
        import ipaddress
        import ifaddr
    except Exception:
        return None
    out = []
    for ad in ifaddr.get_adapters():
        nm = f"{ad.nice_name or ''} {ad.name or ''}".lower()
        if any(b in nm for b in VIRTUAL_ADAPTERS):
            continue
        for ip in ad.ips:
            if isinstance(ip.ip, str):
                a = ipaddress.ip_address(ip.ip)
                if a.is_private and not a.is_loopback and not a.is_link_local:
                    out.append(ip.ip)
    return out or None


def start_discovery():
    """Поиск телефонов RafLink в сети (mDNS _raflink._tcp).
    Только IPv4 и только обычные адаптеры: VPN-клиенты не любят широковещание через свой туннель."""
    try:
        from zeroconf import InterfaceChoice, IPVersion, ServiceBrowser, Zeroconf
    except Exception:
        return None

    class L:
        def add_service(self, zc, t, name):
            def resolve():
                info = zc.get_service_info(t, name, 3000)
                if info:
                    ips = info.parsed_addresses()
                    ip4 = [a for a in ips if "." in a]
                    if ip4:
                        nice = name.replace("._raflink._tcp.local.", "").replace("RafLink ", "")
                        BRIDGE.found.emit(nice, ip4[0], info.port)
            threading.Thread(target=resolve, daemon=True).start()

        update_service = add_service

        def remove_service(self, *a):
            pass

    try:
        zc = Zeroconf(interfaces=lan_ips() or InterfaceChoice.Default, ip_version=IPVersion.V4Only)
        ServiceBrowser(zc, "_raflink._tcp.local.", L())
        return zc
    except Exception:
        return None


# ---------------------------------------------------------------- список файлов

ROLE = Qt.UserRole + 1


class FileDelegate(QStyledItemDelegate):
    def __init__(self, view: "FileView"):
        super().__init__(view)
        self.view = view

    def sizeHint(self, opt, idx):
        if self.view.photo_mode:
            g = self.view.gridSize()
            return g if g.isValid() else QSize(150, 150)
        if self.view.tiles:
            return QSize(150, 156)
        return QSize(max(self.view.viewport().width() - 4, 200), 66)

    def paint(self, p: QPainter, opt, idx):
        e = idx.data(ROLE)
        if not e:
            return
        p.save()
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        r = QRectF(opt.rect)
        sel = bool(opt.state & QStyle.State_Selected)
        hover = bool(opt.state & QStyle.State_MouseOver)
        thumb = self.view.thumbs.get(e["path"])

        if self.view.photo_mode:
            box = r.adjusted(2, 2, -2, -2)
            path = QPainterPath()
            path.addRoundedRect(box, 6, 6)
            p.fillPath(path, QColor(P["sub"]))
            if thumb:
                p.setClipPath(path)
                sc = thumb.size().scaled(box.size().toSize(), Qt.KeepAspectRatioByExpanding)
                tr = QRectF(0, 0, sc.width(), sc.height())
                tr.moveCenter(box.center())
                p.drawPixmap(tr.toRect(), thumb)
                p.setClipping(False)
            else:
                gs = 28
                p.drawPixmap(QRectF(box.center().x() - gs / 2, box.center().y() - gs / 2, gs, gs).toRect(),
                             glyph("play" if type_of(e) == "video" else "image", P["muted"], gs))
            if type_of(e) == "video":
                p.drawPixmap(QRectF(box.left() + 8, box.bottom() - 26, 18, 18).toRect(), glyph("play", "#FFFFFF", 18, 2))
            if sel:
                p.setPen(QPen(QColor(P["accent"]), 3))
                p.setBrush(Qt.NoBrush)
                p.drawRoundedRect(box.adjusted(1.5, 1.5, -1.5, -1.5), 6, 6)
                c = QRectF(box.right() - 36, box.top() + 8, 28, 28)
                p.setPen(QPen(QColor("#FFFFFF"), 2))
                p.setBrush(QColor(P["accent"]))
                p.drawEllipse(c)
                p.drawPixmap(c.adjusted(5, 5, -5, -5).toRect(), glyph("check", "#FFFFFF", 18, 2.6))
            p.restore()
            return

        if sel:
            p.setBrush(QColor(P["wash"]))
            p.setPen(Qt.NoPen)
            p.drawRoundedRect(r.adjusted(2, 1, -2, -1), 12, 12)
        elif hover:
            p.setBrush(QColor(P["hover"]))
            p.setPen(Qt.NoPen)
            p.drawRoundedRect(r.adjusted(2, 1, -2, -1), 12, 12)

        name_font = QFont(opt.font)
        name_font.setPixelSize(16)
        name_font.setWeight(QFont.DemiBold)
        small = QFont(opt.font)
        small.setPixelSize(13)
        meta = self.view.meta_text(e)

        if self.view.tiles:
            box = QRectF(r.left() + 10, r.top() + 8, r.width() - 20, r.height() - 58)
            if thumb:
                path = QPainterPath()
                path.addRoundedRect(box, 10, 10)
                p.setClipPath(path)
                sc = thumb.size().scaled(box.size().toSize(), Qt.KeepAspectRatioByExpanding)
                tr = QRectF(0, 0, sc.width(), sc.height())
                tr.moveCenter(box.center())
                p.drawPixmap(tr.toRect(), thumb)
                p.setClipping(False)
            else:
                ic = type_icon(e, 56)
                s_ = ic.size() / ic.devicePixelRatio()
                p.drawPixmap(QRectF(box.center().x() - s_.width() / 2, box.center().y() - s_.height() / 2,
                                    s_.width(), s_.height()).toRect(), ic)
            tx = QRectF(r.left() + 8, box.bottom() + 6, r.width() - 16, 20)
            p.setFont(name_font)
            p.setPen(QColor(P["text"]))
            p.drawText(tx, Qt.AlignHCenter | Qt.AlignVCenter,
                       QFontMetrics(name_font).elidedText(disp_name(e), Qt.ElideMiddle, int(tx.width())))
            p.setFont(small)
            p.setPen(QColor(P["muted"]))
            p.drawText(QRectF(tx.left(), tx.bottom(), tx.width(), 18), Qt.AlignHCenter | Qt.AlignVCenter,
                       QFontMetrics(small).elidedText(meta, Qt.ElideRight, int(tx.width())))
            p.restore()
            return

        # строка списка: значок · имя · подробности · «›» или «•••»
        ic_w = 38
        box = QRectF(r.left() + 12, r.center().y() - ic_w * 1.15 / 2, ic_w, ic_w * 1.15)
        if thumb:
            path = QPainterPath()
            path.addRoundedRect(box, 8, 8)
            p.setClipPath(path)
            sc = thumb.size().scaled(box.size().toSize(), Qt.KeepAspectRatioByExpanding)
            tr = QRectF(0, 0, sc.width(), sc.height())
            tr.moveCenter(box.center())
            p.drawPixmap(tr.toRect(), thumb)
            p.setClipping(False)
        else:
            p.drawPixmap(box.toRect(), type_icon(e, ic_w))
        right = r.right() - 44
        tx = QRectF(box.right() + 14, r.top() + 11, right - box.right() - 18, 22)
        p.setFont(name_font)
        p.setPen(QColor(P["text"]))
        p.drawText(tx, Qt.AlignLeft | Qt.AlignVCenter,
                   QFontMetrics(name_font).elidedText(disp_name(e), Qt.ElideMiddle, int(tx.width())))
        p.setFont(small)
        p.setPen(QColor(P["muted"]))
        p.drawText(QRectF(tx.left(), tx.bottom() + 1, tx.width(), 19), Qt.AlignLeft | Qt.AlignVCenter,
                   QFontMetrics(small).elidedText(meta, Qt.ElideRight, int(tx.width())))
        if e.get("dir"):
            p.drawPixmap(QRectF(r.right() - 32, r.center().y() - 9, 18, 18).toRect(), glyph("chev", P["muted"], 18, 2))
        else:
            p.setPen(Qt.NoPen)
            p.setBrush(QColor(P["muted"]))
            for k in range(3):
                p.drawEllipse(QRectF(r.right() - 35 + k * 8, r.center().y() - 2, 4.2, 4.2))
        if not sel and not hover and idx.row() < self.view.count() - 1:
            p.setPen(QPen(QColor(P["line"]), 1))
            p.drawLine(QPoint(int(tx.left()), int(r.bottom())), QPoint(int(r.right() - 8), int(r.bottom())))
        p.restore()


class FileView(QListWidget):
    """Файлы телефона. Перетаскивание наружу = скачать и отдать Проводнику."""
    open_dir = Signal(str)

    def __init__(self, app: "MainWindow"):
        super().__init__()
        self.app = app
        self.tiles = False
        self.photo_mode = False
        self.thumbs: dict = {}
        self._thumb_wait: set = set()
        self._thumb_sem = threading.Semaphore(4)
        self.setItemDelegate(FileDelegate(self))
        self.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.setDragEnabled(True)
        self.setDragDropMode(QAbstractItemView.DragOnly)
        self.setDefaultDropAction(Qt.CopyAction)
        self.setAcceptDrops(False)
        self.setMouseTracking(True)
        self.setVerticalScrollMode(QAbstractItemView.ScrollPerPixel)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setUniformItemSizes(True)
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._menu)
        self.itemActivated.connect(self._activate)
        self.verticalScrollBar().valueChanged.connect(lambda *_: self._want_thumbs())
        self.set_tiles(False)

    def set_photo_mode(self):
        """Галерея: квадратные миниатюры по 3 в ряд, без подписей, синие галочки у выбранных."""
        self.photo_mode = True
        self.set_tiles(True)
        self._fit_grid()

    def _fit_grid(self):
        if self.photo_mode:
            w = max(90, (self.width() - 2 * self.frameWidth() - 14) // 3)   # 14 — запас под полосу прокрутки
            self.setGridSize(QSize(w, w))

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        QTimer.singleShot(0, self._refit)

    def _refit(self):
        if self.photo_mode:
            old = self.gridSize()
            self._fit_grid()
            if self.gridSize() != old:
                self.doItemsLayout()
        self._want_thumbs()

    def showEvent(self, ev):
        super().showEvent(ev)
        QTimer.singleShot(0, self._refit)

    def set_tiles(self, on: bool):
        self.tiles = on
        if on:
            self.setViewMode(QListWidget.IconMode)
            self.setGridSize(QSize(154, 160))
            self._fit_grid()
            self.setResizeMode(QListWidget.Adjust)
            self.setMovement(QListWidget.Static)
            self.setWrapping(True)
            self.setSpacing(0)
        else:
            self.setViewMode(QListWidget.ListMode)
            self.setGridSize(QSize())
            self.setWrapping(False)
            self.setMovement(QListWidget.Static)
        self.doItemsLayout()
        QTimer.singleShot(0, self._want_thumbs)

    def meta_text(self, e):
        if e.get("dir"):
            return "Папка" + (f' · {e["name"]}' if ru_name(e["name"]) != e["name"] else "")
        x = ext_of(e["name"]).upper() or "Файл"
        return f'{x} · {human(e.get("size") or 0)} · {short_when(e.get("mtime"))}'

    def set_entries(self, entries):
        self.clear()
        for e in entries:
            it = QListWidgetItem()
            it.setData(ROLE, e)
            it.setToolTip(e["name"])
            self.addItem(it)
        QTimer.singleShot(0, self._want_thumbs)

    def entries(self, selected=True):
        items = self.selectedItems() if selected else [self.item(i) for i in range(self.count())]
        return [i.data(ROLE) for i in items]

    def _want_thumbs(self):
        if not self.tiles or self.app.client is None:
            return
        vp = self.viewport().rect()
        for i in range(self.count()):
            it = self.item(i)
            if not self.visualItemRect(it).intersects(vp):
                continue
            e = it.data(ROLE)
            if not has_thumb(e) or e["path"] in self.thumbs or e["path"] in self._thumb_wait:
                continue
            self._thumb_wait.add(e["path"])
            client, path = self.app.client, e["path"]

            def fetch(client=client, path=path):
                with self._thumb_sem:
                    return path, client.thumb(path, 320)

            run_bg(fetch, self._got_thumb, lambda ex, path=path: self._thumb_wait.discard(path))

    def _got_thumb(self, res):
        path, data = res
        self._thumb_wait.discard(path)
        pm = QPixmap()
        if pm.loadFromData(data):
            self.thumbs[path] = pm
            self.viewport().update()

    def _activate(self, it):
        e = it.data(ROLE)
        if e.get("dir"):
            self.open_dir.emit(e["path"])
        else:
            self.app.open_entries([e])

    def mousePressEvent(self, ev):
        if ev.button() == Qt.BackButton:
            self.app.go_back()
            return
        it = self.itemAt(ev.position().toPoint())
        if (it and ev.button() == Qt.LeftButton and not self.tiles
                and ev.position().x() > self.viewport().width() - 46 and not it.data(ROLE).get("dir")):
            if not it.isSelected():
                self.clearSelection()
                it.setSelected(True)
            self._menu(ev.position().toPoint())
            return
        super().mousePressEvent(ev)

    def keyPressEvent(self, ev):
        if ev.key() == Qt.Key_Backspace:
            self.app.go_back()
            return
        super().keyPressEvent(ev)

    def _menu(self, pos):
        files = [e for e in self.entries() if not e.get("dir")]
        m = QMenu(self)
        if files:
            m.addAction("Открыть", lambda: self.app.open_entries(files))
            m.addAction("Сохранить во «Входящие»", lambda: self.app.save_entries(files))
            m.addAction("Сохранить в папку…", lambda: self.app.save_entries(files, ask=True))
            m.addSeparator()
        m.addAction("Обновить", self.app.reload)
        m.exec(self.viewport().mapToGlobal(pos))

    def startDrag(self, actions):
        files = [e for e in self.entries() if not e.get("dir")]
        if not files:
            return
        ready = all(cache_path(e).exists() and cache_path(e).stat().st_size == int(e.get("size") or -1)
                    for e in files)
        paths = []
        if ready:
            paths = [cache_path(e) for e in files]
        else:
            if self.app.transfers.busy:
                self.app.toast.message("Дождитесь окончания текущей передачи")
                return
            loop = QEventLoop()
            out = {}

            def then(res, err):
                out["res"], out["err"] = res, err
                loop.quit()

            self.app.transfers.download(files, None, then)
            loop.exec()
            if out.get("err"):
                return
            paths = out["res"]
            if not (QApplication.mouseButtons() & Qt.LeftButton):
                self.app.toast.message("Файлы готовы — перетащите их ещё раз, теперь мгновенно", ok=True)
                return
        md = QMimeData()
        md.setUrls([QUrl.fromLocalFile(str(p)) for p in paths])
        md.setData("application/x-raflink", b"1")
        drag = QDrag(self)
        drag.setMimeData(md)
        drag.setPixmap(drag_pixmap(files))
        drag.setHotSpot(QPoint(-12, -12))
        drag.exec(Qt.CopyAction, Qt.CopyAction)


def drag_pixmap(files) -> QPixmap:
    text = files[0]["name"] if len(files) == 1 else f"Файлов: {len(files)}"
    f = QFont()
    f.setPixelSize(16)
    f.setWeight(QFont.DemiBold)
    fm = QFontMetrics(f)
    text = fm.elidedText(text, Qt.ElideMiddle, 260)
    pad = 10
    w, h = fm.horizontalAdvance(text) + 76, 58
    pm = QPixmap((w + pad * 2) * 2, (h + pad * 2) * 2)
    pm.setDevicePixelRatio(2)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    for k in range(pad, 0, -2):   # мягкая тень
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0, 6))
        p.drawRoundedRect(QRectF(pad - k / 2, pad - k / 2 + 3, w + k, h + k), 16, 16)
    p.setBrush(QColor(P["surface"]))
    p.drawRoundedRect(QRectF(pad, pad, w, h), 14, 14)
    ic = type_icon(files[0], 34)
    p.drawPixmap(QRectF(pad + 12, pad + (h - 39) / 2, 34, 39).toRect(), ic)
    p.setFont(f)
    p.setPen(QColor(P["text"]))
    p.drawText(QRectF(pad + 58, pad, w - 64, h), Qt.AlignVCenter, text)
    p.end()
    return pm


# ---------------------------------------------------------------- панель передачи (тост)

class Toast(QFrame):
    """Плашка внизу: ход передачи и итог (как в макете)."""

    def __init__(self, app: "MainWindow"):
        super().__init__()
        self.app = app
        self.setObjectName("toast")
        outer = QHBoxLayout(self)
        outer.setContentsMargins(16, 12, 12, 12)
        outer.setSpacing(12)
        self.icon = QLabel()
        self.icon.setPixmap(glyph("pc", P["accent"], 28))
        outer.addWidget(self.icon, 0, Qt.AlignTop)
        lay = QVBoxLayout()
        lay.setSpacing(6)
        row = QHBoxLayout()
        self.title = label("", "h3")
        self.title.setWordWrap(True)
        row.addWidget(self.title, 1)
        self.bx = button("✕", "icon", fn=self.hide)
        row.addWidget(self.bx, 0, Qt.AlignTop)
        lay.addLayout(row)
        self.name = label("", "muted", wrap=True)
        lay.addWidget(self.name)
        self.bar = QProgressBar()
        self.bar.setFixedHeight(6)
        self.bar.setTextVisible(False)
        self.bar.setRange(0, 1000)
        lay.addWidget(self.bar)
        self.sub = label("", "small")
        lay.addWidget(self.sub)
        brow = QHBoxLayout()
        self.b1 = button("", "tinted")
        self.b2 = button("")
        for b in (self.b1, self.b2):
            b.setMinimumHeight(38)
            brow.addWidget(b)
        brow.addStretch(1)
        lay.addLayout(brow)
        outer.addLayout(lay, 1)
        self._timer = QTimer(self, singleShot=True, timeout=self.hide)
        self.hide()

    def _btn(self, b, text, fn):
        if getattr(b, "_fn", None):
            b.clicked.disconnect(b._fn)
        b._fn = fn
        b.setVisible(bool(text))
        b.setText(text)
        if fn:
            b.clicked.connect(fn)

    def transfer(self, direction, first, count):
        self._timer.stop()
        self.icon.setPixmap(glyph("pc" if direction != "out" else "phone", P["accent"], 28))
        self.title.setStyleSheet("")
        self.title.setText({"in": "Телефон → ПК", "push": "Принимаю с телефона", "out": "ПК → Телефон"}[direction])
        self.name.setText(first + (f"  +{count - 1}" if count > 1 else ""))
        self.name.show()
        self.bar.setValue(0)
        self.bar.show()
        self.sub.setText("Начинаю передачу…")
        self.sub.show()
        self._btn(self.b1, "Отмена", self.app.transfers.cancel)
        self._btn(self.b2, "", None)
        self.bx.hide()
        self.show()

    def progress(self, done, total, speed):
        self.bar.setValue(int(done * 1000 / max(total, 1)))
        if speed > 0:
            left = (total - done) / speed
            self.sub.setText(f"{human(speed)}/с · осталось {max(1, int(left))} с · {human(done)} из {human(total)}")

    def result(self, title, text="", ok=True, b1=None, b2=None, hide_after=0):
        self._timer.stop()
        self.icon.setPixmap(glyph("check" if ok else "wifi", P["ok"] if ok else P["err"], 28, 2.2))
        self.title.setText(title)
        self.title.setStyleSheet(f"color:{P['text'] if ok else P['err']}")
        self.name.setText(text)
        self.name.setVisible(bool(text))
        self.bar.hide()
        self.sub.hide()
        self._btn(self.b1, *(b1 or ("", None)))
        self._btn(self.b2, *(b2 or ("", None)))
        self.bx.show()
        self.show()
        if hide_after:
            self._timer.start(hide_after)

    def message(self, text, ok=False):
        if self.app.transfers.busy:
            return
        self.result(text, ok=True, hide_after=4500)
        if not ok:
            self.icon.setPixmap(glyph("doc", P["accent"], 28))


# ---------------------------------------------------------------- подложка «Отпустите»

class Veil(QFrame):
    dropped = Signal(list)

    def __init__(self, parent):
        super().__init__(parent)
        self.setObjectName("veil")
        self.setAcceptDrops(True)
        lay = QVBoxLayout(self)
        lay.setAlignment(Qt.AlignCenter)
        lay.setSpacing(14)
        ic = QLabel()
        circ = QPixmap(220, 220)
        circ.setDevicePixelRatio(2)
        circ.fill(Qt.transparent)
        cp = QPainter(circ)
        cp.setRenderHint(QPainter.Antialiasing)
        cp.setPen(Qt.NoPen)
        cp.setBrush(QColor(P["accent"]))
        cp.drawEllipse(QRectF(2, 2, 106, 106))
        cp.drawPixmap(QRectF(27, 27, 56, 56).toRect(), glyph("down", "#FFFFFF", 56, 2.4))
        cp.end()
        ic.setPixmap(circ)
        ic.setAlignment(Qt.AlignCenter)
        lay.addWidget(ic)
        t = label("Отпустите — отправлю\nна телефон", "veiltext", wrap=True)
        t.setAlignment(Qt.AlignCenter)
        lay.addWidget(t)
        s = label("Файлы попадут в «Загрузки/RafLink» на телефоне", "muted", wrap=True)
        s.setAlignment(Qt.AlignCenter)
        lay.addWidget(s)
        self.hide()

    def dragEnterEvent(self, ev):
        ev.acceptProposedAction()

    def dragMoveEvent(self, ev):
        ev.acceptProposedAction()

    def dragLeaveEvent(self, ev):
        self.hide()

    def dropEvent(self, ev):
        self.hide()
        paths = [Path(u.toLocalFile()) for u in ev.mimeData().urls() if u.isLocalFile()]
        ev.acceptProposedAction()
        self.dropped.emit(paths)


# ---------------------------------------------------------------- мини-капсула

class Capsule(QFrame):
    def __init__(self, app: "MainWindow"):
        super().__init__(None, Qt.Tool | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint)
        self.app = app
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAcceptDrops(True)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        self.body = QFrame()
        self.body.setObjectName("capsule")
        outer.addWidget(self.body)
        lay = QHBoxLayout(self.body)
        lay.setContentsMargins(14, 8, 8, 8)
        ic = QLabel()
        ic.setPixmap(app_icon_pixmap(56).scaled(28, 28, Qt.KeepAspectRatio, Qt.SmoothTransformation))
        lay.addWidget(ic)
        col = QVBoxLayout()
        col.setSpacing(0)
        self.t = label("RafLink", "h3")
        self.t.setStyleSheet("font-size:15px")
        self.s = label("Бросьте файл — уйдёт на телефон", "small")
        col.addWidget(self.t)
        col.addWidget(self.s)
        lay.addLayout(col)
        lay.addWidget(button("", "icon", icon="mini", tip="Развернуть окно", fn=self.restore))
        self._drag = None

    def restore(self):
        self.hide()
        self.app.show_normal()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._drag = e.globalPosition().toPoint() - self.frameGeometry().topLeft()

    def mouseMoveEvent(self, e):
        if self._drag is not None and e.buttons() & Qt.LeftButton:
            self.move(e.globalPosition().toPoint() - self._drag)

    def mouseReleaseEvent(self, e):
        self._drag = None

    def mouseDoubleClickEvent(self, e):
        self.restore()

    def dragEnterEvent(self, ev):
        if ev.mimeData().hasUrls() and not ev.mimeData().hasFormat("application/x-raflink"):
            self.s.setText("Отпустите — отправлю на телефон")
            ev.acceptProposedAction()

    def dragLeaveEvent(self, ev):
        self.s.setText("Бросьте файл — уйдёт на телефон")

    def dropEvent(self, ev):
        self.s.setText("Бросьте файл — уйдёт на телефон")
        self.app.upload_paths([Path(u.toLocalFile()) for u in ev.mimeData().urls() if u.isLocalFile()])
        ev.acceptProposedAction()

    def place(self):
        scr = QApplication.primaryScreen().availableGeometry()
        self.adjustSize()
        self.move(scr.right() - self.width() - 24, scr.bottom() - self.height() - 24)


# ---------------------------------------------------------------- окно

PAIR_ART = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 130" fill="none" stroke-linecap="round"
 stroke-linejoin="round"><ellipse cx="150" cy="66" rx="128" ry="58" stroke="{a}" stroke-opacity=".35" stroke-width="2"/>
<rect x="26" y="34" width="96" height="62" rx="8" fill="{w}" stroke="{a}" stroke-width="3"/>
<path d="M14 102h120l-6 8H20z" fill="{w}" stroke="{a}" stroke-width="3"/>
<path d="M66 69l14-14 M62 66l-3 3a7 7 0 0010 10l6-6 M84 58l3-3a7 7 0 00-10-10l-6 6" stroke="{a}" stroke-width="3"/>
<path d="M134 56q16-14 32 0 M140 64q10-8 20 0" stroke="{a}" stroke-width="4"/><circle cx="150" cy="72" r="3.5" fill="{a}"/>
<rect x="196" y="18" width="52" height="96" rx="11" fill="{w}" stroke="{a}" stroke-width="3"/>
<path d="M214 26h16" stroke="{a}" stroke-width="3"/>
<path d="M216 69l12-12 M213 66l-3 3a6 6 0 008 8l5-5 M231 60l3-3a6 6 0 00-8-8l-5 5" stroke="{a}" stroke-width="3"/></svg>"""


def svg_pixmap(svg: str, w: int, h: int) -> QPixmap:
    pm = QPixmap(w * 2, h * 2)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(0, 0, w * 2, h * 2))
    p.end()
    pm.setDevicePixelRatio(2)
    return pm


class PinBoxes(QWidget):
    """6 клеток для кода с телефона; вставка из буфера тоже работает."""
    submitted = Signal()

    def __init__(self):
        super().__init__()
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(8)
        self.boxes = []
        for i in range(6):
            e = QLineEdit()
            e.setObjectName("digit")
            e.setAlignment(Qt.AlignCenter)
            e.setMaxLength(6)
            e.setFixedHeight(62)
            e.setMinimumWidth(44)
            e.textEdited.connect(lambda t, i=i: self._typed(i, t))
            e.installEventFilter(self)
            e.returnPressed.connect(self.submitted.emit)
            lay.addWidget(e)
            self.boxes.append(e)

    def _typed(self, i, t):
        digits = re.sub(r"\D", "", t)
        if len(digits) > 1:          # вставили весь код
            self.set_value(digits)
            return
        self.boxes[i].setText(digits)
        if digits and i < 5:
            self.boxes[i + 1].setFocus()
            self.boxes[i + 1].selectAll()
        if len(self.value()) == 6:
            self.submitted.emit()

    def eventFilter(self, obj, ev):
        if ev.type() == ev.Type.KeyPress and ev.key() == Qt.Key_Backspace and not obj.text():
            i = self.boxes.index(obj)
            if i > 0:
                self.boxes[i - 1].clear()
                self.boxes[i - 1].setFocus()
                return True
        return False

    def value(self):
        return "".join(b.text() for b in self.boxes)

    def set_value(self, digits):
        for i, b in enumerate(self.boxes):
            b.setText(digits[i] if i < len(digits) else "")
        self.boxes[min(len(digits), 5)].setFocus()

    def clear(self):
        self.set_value("")
        self.boxes[0].setFocus()


class AlbumChips(QWidget):
    """Альбомы галереи — ряд «чипов» как в макете (повторяет нужную часть API QComboBox)."""
    currentIndexChanged = Signal(int)

    def __init__(self):
        super().__init__()
        self.setObjectName("chips")
        self.row = QHBoxLayout(self)
        self.row.setContentsMargins(0, 0, 0, 0)
        self.row.setSpacing(4)
        self.row.addStretch(1)
        self.items = []   # (кнопка, данные)
        self.cur = -1

    def clear(self):
        for b, _ in self.items:
            b.hide()
            b.deleteLater()
        self.items = []
        self.cur = -1

    def addItem(self, text, data):
        b = button(text, "chip")
        b.setCheckable(True)
        i = len(self.items)
        b.clicked.connect(lambda _=False, i=i: self.setCurrentIndex(i))
        self.row.insertWidget(self.row.count() - 1, b)
        self.items.append((b, data))

    def count(self):
        return len(self.items)

    def findData(self, data):
        return next((i for i, (_, d) in enumerate(self.items) if d == data), -1)

    def currentData(self):
        return self.items[self.cur][1] if 0 <= self.cur < len(self.items) else None

    def setCurrentIndex(self, i):
        changed = i != self.cur
        self.cur = i
        for k, (b, _) in enumerate(self.items):
            b.setChecked(k == i)
        if changed and not self.signalsBlocked():
            self.currentIndexChanged.emit(i)


QUICK = [("Загрузки", "down", "Download"), ("Камера", "cam", "DCIM/Camera"), ("Документы", "doc", "Documents"),
         ("Telegram", "send", "Download/Telegram"), ("WhatsApp", "chat", "Android/media/com.whatsapp/WhatsApp/Media"),
         ("Скриншоты", "shot", "DCIM/Screenshots")]


class MainWindow(QMainWindow):
    def __init__(self, config: Config):
        super().__init__()
        self.config = config
        self.client: PhoneClient | None = None
        self.online = False
        self.info: dict = {}
        self.cur_path = PHONE_ROOT + "/Download"
        self.raw_entries: list = []
        self.back_stack: list = []
        self._loaded_once = False
        self._outbox_busy = False
        self._zc = None
        self.found: dict = {}
        self._polling = False
        self._fails = 0
        self.transfers = Transfers(self)

        self.setWindowTitle(f"RafLink {APP_VER}")
        self.setWindowIcon(QIcon(app_icon_pixmap()))
        self.resize(520, 880)
        self.setMinimumSize(440, 600)
        self.setAcceptDrops(True)

        root = QWidget()
        root.setObjectName("root")
        self.setCentralWidget(root)
        v = QVBoxLayout(root)
        v.setContentsMargins(12, 12, 12, 12)
        v.setSpacing(10)

        # карточка телефона: значок, имя, статус, заряд
        dev, h = card(v, (14, 12, 8, 12), 12, horizontal=True)
        box = QFrame()
        box.setObjectName("iconbox")
        box.setFixedSize(54, 54)
        bl = QVBoxLayout(box)
        bl.setContentsMargins(0, 0, 0, 0)
        ic = QLabel()
        ic.setPixmap(glyph("phone", P["accent"], 32, 1.8))
        ic.setAlignment(Qt.AlignCenter)
        bl.addWidget(ic)
        h.addWidget(box)
        col = QVBoxLayout()
        col.setSpacing(2)
        self.dev_name = label("Телефон", "devname")
        self.dev_state = QLabel()
        col.addWidget(self.dev_name)
        col.addWidget(self.dev_state)
        h.addLayout(col, 1)
        self.battery = Battery()
        self.batt = label("", "muted")
        self.batt.setStyleSheet("font-size:16px")
        h.addWidget(self.battery)
        h.addWidget(self.batt)
        h.addSpacing(4)
        h.addWidget(button("", "icon", icon="mini", tip="Мини-режим: капсула для файлов", fn=self.to_mini,
                           color=P["muted"]))
        gb = button("", "icon", icon="gear", tip="Настройки и «О программе»", color=P["muted"])
        gm = QMenu(gb)
        gm.addAction("Настройки…", self.settings)
        gm.addAction("Папка «Входящие»", lambda: open_local(self.config.inbox()))
        gm.addSeparator()
        gm.addAction(f"О программе RafLink {APP_VER}", self.about)
        gm.addAction(f"Написать автору: {APP_EMAIL}", mail_author)
        gb.clicked.connect(lambda: gm.exec(gb.mapToGlobal(QPoint(gb.width() - gm.sizeHint().width(), gb.height()))))
        h.addWidget(gb)
        self._set_state(False)

        # переключатель «Файлы | Галерея | История»
        tb, tl = card(v, (6, 6, 6, 6), 0)
        track = QFrame()
        track.setObjectName("segtrack")
        th = QHBoxLayout(track)
        th.setContentsMargins(3, 3, 3, 3)
        th.setSpacing(3)
        self.tab_btns = []
        for i, t in enumerate(["Файлы", "Галерея", "История"]):
            b = button(t, "seg", fn=lambda _=False, i=i: self.switch_tab(i))
            b.setCheckable(True)
            th.addWidget(b, 1)
            self.tab_btns.append(b)
        tl.addWidget(track)
        self.tabbar = tb

        # страницы
        self.pages = QStackedWidget()
        v.addWidget(self.pages, 1)
        self.page_files = self._build_files()
        self.page_photos = self._build_photos()
        self.page_hist = self._build_history()
        self.page_offline = self._build_offline()
        self.page_pair = self._build_pair()
        for w in (self.page_files, self.page_photos, self.page_hist, self.page_offline, self.page_pair):
            self.pages.addWidget(w)

        self.toast = Toast(self)
        v.addWidget(self.toast)

        self.veil = Veil(root)
        self.veil.dropped.connect(self.upload_paths)
        self.capsule = Capsule(self)

        self.transfers.started.connect(self.toast.transfer)
        self.transfers.progress.connect(self.toast.progress)
        self.transfers.finished.connect(self._transfer_done)
        BRIDGE.found.connect(self._found)
        BRIDGE.show_window.connect(self.show_normal)

        self._tray()
        self.poll_timer = QTimer(self, interval=4000, timeout=self.poll)
        self.poll_timer.start()

        ph = config["phone"]
        if ph:
            self.client = PhoneClient(ph["host"], ph.get("port", PHONE_PORT), ph["token"])
            self.dev_name.setText(ph.get("name") or "Телефон")
            self.show_page("offline")
            self.poll()
        else:
            self.show_page("pair")

    # ---------- построение страниц

    def _page(self):
        w = QWidget()
        w.setObjectName("page")
        lay = QVBoxLayout(w)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(10)
        return w, lay

    def _build_files(self):
        w, lay = self._page()
        self.banner = QFrame()
        self.banner.setObjectName("banner")
        bl = QVBoxLayout(self.banner)
        bl.addWidget(label("На телефоне не разрешён доступ к файлам. Откройте RafLink на телефоне → "
                           "«Доступ ко всем файлам» и включите переключатель.", wrap=True))
        self.banner.hide()
        lay.addWidget(self.banner)

        qc, ql = card(lay, (12, 12, 12, 12), 0)
        grid = QGridLayout()
        grid.setSpacing(8)
        self.quick_btns = []
        for i, (t, ic, sub) in enumerate(QUICK):
            b = button(t, "quick", fn=lambda _=False, sub=sub: self.load(PHONE_ROOT + "/" + sub))
            b.setIcon(QIcon(glyph("folder", P["accent"], 26, 1.6)))
            b.setIconSize(QSize(26, 26))
            b.setCheckable(True)
            grid.addWidget(b, i // 3, i % 3)
            self.quick_btns.append((b, PHONE_ROOT + "/" + sub))
        ql.addLayout(grid)

        lc, ll = card(lay, (8, 10, 8, 6), 6)
        self.crumbs = QHBoxLayout()
        self.crumbs.setSpacing(0)
        self.crumbs.setContentsMargins(4, 0, 0, 0)
        self.back_btn = button("", "icon", icon="back", tip="Назад (Alt+←, Backspace)", fn=self.go_back)
        self.up_btn = button("", "icon", icon="up", tip="На уровень выше", fn=self.go_up)
        ll.addLayout(self.crumbs)

        tools = QHBoxLayout()
        tools.setContentsMargins(6, 0, 6, 0)
        tools.setSpacing(4)
        self.search = QLineEdit()
        self.search.setObjectName("search")
        self.search.setPlaceholderText("Поиск")
        self.search.setClearButtonEnabled(True)
        self.search.addAction(QIcon(glyph("search", P["muted"], 20)), QLineEdit.LeadingPosition)
        self.search.textChanged.connect(self.refilter)
        tools.addWidget(self.search, 1)
        self.sort = QComboBox()            # невидимый: хранит выбранную сортировку
        self.sort.addItems(["Сначала новые", "По имени", "По размеру"])
        self.sort.currentIndexChanged.connect(self.refilter)
        self.sort.hide()
        sb = button("", "icon", icon="sort", tip="Сортировка")
        sm = QMenu(sb)
        for i, t in enumerate(["Сначала новые", "По имени", "По размеру"]):
            sm.addAction(t, lambda i=i: self.sort.setCurrentIndex(i))
        sb.clicked.connect(lambda: sm.exec(sb.mapToGlobal(QPoint(0, sb.height()))))
        tools.addWidget(sb)
        self.view_btn = button("", "icon", icon="tiles", tip="Список или плитка", fn=self.toggle_view)
        tools.addWidget(self.view_btn)
        tools.addWidget(button("", "icon", icon="refresh", tip="Обновить (F5)", fn=self.reload))
        ll.addLayout(tools)
        ll.addSpacing(2)
        ll.addWidget(sep_line())

        self.view = FileView(self)
        self.view.open_dir.connect(self.load)
        self.view.itemSelectionChanged.connect(self._sel_changed)
        ll.addWidget(self.view, 1)
        self.empty = label("", "muted")
        self.empty.setAlignment(Qt.AlignCenter)
        self.empty.setWordWrap(True)
        self.empty.hide()
        ll.addWidget(self.empty, 1)
        lay.setStretchFactor(lc, 1)

        fc, fl = card(lay, (10, 10, 10, 10), 8, horizontal=True)
        self.count_lbl = label("", "small")   # число объектов — в подсказке кнопки «Открыть»
        self.btn_open = button("Открыть", "primary", fn=lambda: self.open_entries(self._sel_files()))
        self.btn_open.setIcon(QIcon(glyph("open", "#FFFFFF", 20, 2)))
        self.btn_save = button("На ПК", "tinted", tip="Сохранить выбранные в папку «Входящие»",
                               fn=lambda: self.save_entries(self._sel_files()))
        self.btn_save.setIcon(QIcon(glyph("pc", P["accent"], 20, 2)))
        self.btn_send = button("На телефон", "tinted", tip="Выбрать файлы на ПК и отправить на телефон",
                               fn=self.pick_upload)
        self.btn_send.setIcon(QIcon(glyph("phone", P["accent"], 20, 2)))
        for b in (self.btn_open, self.btn_save, self.btn_send):
            b.setIconSize(QSize(20, 20))
            fl.addWidget(b, 1)
        self.view.setToolTip("Перетащите файл мышкой в Проводник или на рабочий стол.\n"
                             "Обратно — бросьте файл с ПК на это окно.")
        return w

    def _build_photos(self):
        w, lay = self._page()
        ac, al = card(lay, (8, 8, 8, 8), 0)
        sc = QScrollArea()
        sc.setWidgetResizable(True)
        sc.setFrameShape(QFrame.NoFrame)
        sc.setHorizontalScrollBarPolicy(Qt.ScrollBarAsNeeded)
        sc.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        sc.setFixedHeight(46)
        self.album_box = AlbumChips()
        self.album_box.currentIndexChanged.connect(self.load_photos)
        sc.setWidget(self.album_box)
        al.addWidget(sc)

        pc, pl = card(lay, (10, 12, 10, 10), 8)
        top = QHBoxLayout()
        top.setContentsMargins(6, 0, 0, 0)
        self.photo_count = label("", "h3")
        top.addWidget(self.photo_count, 1)
        top.addWidget(button("", "icon", icon="refresh", tip="Обновить", fn=self.load_albums))
        pl.addLayout(top)
        self.photos = FileView(self)
        self.photos.set_photo_mode()
        self.photos.itemSelectionChanged.connect(self._photo_sel)
        pl.addWidget(self.photos, 1)
        self.photo_empty = label("", "muted")
        self.photo_empty.setAlignment(Qt.AlignCenter)
        self.photo_empty.setWordWrap(True)
        self.photo_empty.hide()
        pl.addWidget(self.photo_empty, 1)
        lay.setStretchFactor(pc, 1)
        self.photo_btn = button("На ПК", "primary", fn=lambda: self.save_entries(self.photos.entries()))
        self.photo_btn.setIcon(QIcon(glyph("pc", "#FFFFFF", 22, 2)))
        self.photo_btn.setIconSize(QSize(22, 22))
        self.photo_btn.setMinimumHeight(52)
        lay.addWidget(self.photo_btn)
        return w

    def _build_history(self):
        w, lay = self._page()
        hc, hl = card(lay, (12, 12, 12, 12), 8)
        top = QHBoxLayout()
        top.addWidget(label("История передач", "h2"), 1)
        top.addWidget(button("Входящие", "tinted", fn=lambda: open_local(self.config.inbox())))
        hl.addLayout(top)
        self.hist = QListWidget()
        self.hist.setVerticalScrollMode(QAbstractItemView.ScrollPerPixel)
        self.hist.setSelectionMode(QAbstractItemView.NoSelection)
        hl.addWidget(self.hist, 1)
        lay.setStretchFactor(hc, 1)
        return w

    def _build_offline(self):
        w, lay = self._page()
        lay.addStretch(1)
        ic = QLabel()
        ic.setPixmap(glyph("wifi", P["warn"], 64, 1.8))
        ic.setAlignment(Qt.AlignCenter)
        lay.addWidget(ic)
        t = label("Нет связи с телефоном", "h2")
        t.setAlignment(Qt.AlignCenter)
        lay.addWidget(t)
        self.off_text = label("", "muted", wrap=True)
        self.off_text.setAlignment(Qt.AlignCenter)
        lay.addWidget(self.off_text)
        nc, nl = card(lay, (16, 14, 16, 14), 10)
        for s_ in ["1. Телефон и ПК подключены к одной сети.",
                   "2. На телефоне открыто приложение RafLink (в шторке — «На связи…»).",
                   "3. Xiaomi: RafLink → «Работа в фоне без ограничений» и «Автозапуск»."]:
            nl.addWidget(label(s_, wrap=True))
        row = QHBoxLayout()
        row.addWidget(button("Повторить", "primary", fn=self.poll), 1)
        row.addWidget(button("Другой телефон", "tinted", fn=lambda: self.show_page("pair")), 1)
        lay.addLayout(row)
        lay.addStretch(2)
        return w

    def _build_pair(self):
        w, lay = self._page()
        lay.setSpacing(8)
        art = QLabel()
        art.setPixmap(svg_pixmap(PAIR_ART.format(a=P["accent"], w=P["wash"]), 300, 130))
        art.setAlignment(Qt.AlignCenter)
        lay.addWidget(art)
        t = label("Первое подключение", "h1")
        t.setAlignment(Qt.AlignCenter)
        lay.addWidget(t)
        sub = label("Выберите телефон в сети Wi-Fi.", "muted")
        sub.setAlignment(Qt.AlignCenter)
        sub.setStyleSheet("font-size:16px")
        lay.addWidget(sub)

        fc, fl = card(lay, (6, 12, 6, 8), 4)
        hdr = label("Найденные телефоны", "label")
        hdr.setContentsMargins(12, 0, 0, 0)
        fl.addWidget(hdr)
        self.found_list = QListWidget()
        self.found_list.setMaximumHeight(130)
        self.found_list.setMinimumHeight(52)
        self.found_list.currentRowChanged.connect(self._found_pick)
        fl.addWidget(self.found_list)
        self.searching = label("Ищу телефон…", "accent")
        self.searching.setContentsMargins(12, 0, 0, 0)
        fl.addWidget(self.searching)
        self.addr = QLineEdit()
        self.addr.setPlaceholderText("или адрес телефона, например 192.168.1.34")
        fl.addWidget(self.addr)

        t2 = label("Код с телефона", "h2")
        t2.setAlignment(Qt.AlignCenter)
        lay.addSpacing(6)
        lay.addWidget(t2)
        s2 = label("Введите 6 цифр из приложения RafLink.", "muted")
        s2.setAlignment(Qt.AlignCenter)
        lay.addWidget(s2)
        pc, pl = card(lay, (14, 12, 14, 12), 0)
        self.pin = PinBoxes()
        self.pin.submitted.connect(self.do_pair)
        pl.addWidget(self.pin)
        self.pair_err = label("", "err", wrap=True)
        self.pair_err.setAlignment(Qt.AlignCenter)
        lay.addWidget(self.pair_err)
        lay.addStretch(1)
        self.pair_btn = button("Подключить", "primary", fn=self.do_pair)
        self.pair_btn.setMinimumHeight(52)
        lay.addWidget(self.pair_btn)
        self.pair_cancel = button("Отмена", "link", fn=lambda: self.show_page("files" if self.online else "offline"))
        lay.addWidget(self.pair_cancel)
        sign = button(f"RafLink {APP_VER} · {APP_COPYRIGHT} · {APP_EMAIL}", "link", fn=self.about)
        sign.setStyleSheet(f"color:{P['muted']}; font-weight:400; font-size:13px")
        lay.addWidget(sign)
        return w

    def _set_state(self, online: bool):
        c = P["ok"] if online else P["warn"]
        t = "Подключено" if online else "Нет связи"
        self.dev_state.setText(f'<span style="color:{c}; font-size:15px">●</span>&nbsp;&nbsp;'
                               f'<span style="color:{P["muted"]}; font-size:16px">{t}</span>')

    # ---------- навигация по страницам

    def discovery(self, on: bool, wait=False):
        """Поиск телефона в сети работает только пока он нужен: при подключении и при потере связи."""
        if on and self._zc is None:
            self._zc = start_discovery()
        elif not on and self._zc is not None:
            zc, self._zc = self._zc, None
            if wait:
                try:
                    zc.close()
                except Exception:
                    pass
            else:
                threading.Thread(target=lambda: zc.close(), daemon=True).start()

    def show_page(self, name):
        idx = {"files": 0, "photos": 1, "hist": 2, "offline": 3, "pair": 4}[name]
        self.discovery(name in ("offline", "pair"))
        self.pages.setCurrentIndex(idx)
        self.tabbar.setVisible(idx < 3)
        for i, b in enumerate(self.tab_btns):
            b.setChecked(i == idx)
        if name == "pair":
            self.pair_cancel.setVisible(self.config["phone"] is not None)
            self.pin.clear()
            self.pair_err.clear()
        if name == "hist":
            self.fill_history()

    def switch_tab(self, i):
        if not self.online:
            self.show_page("offline")
            return
        self.show_page(["files", "photos", "hist"][i])
        if i == 1 and self.album_box.count() == 0:
            self.load_albums()

    # ---------- сопряжение

    def _found(self, name, ip, port):
        if ip in self.found:
            return
        self.found[ip] = (name, port)
        it = QListWidgetItem()
        it.setData(ROLE, ip)
        row = QWidget()
        rl = QHBoxLayout(row)
        rl.setContentsMargins(12, 6, 12, 6)
        ic = QLabel()
        ic.setPixmap(glyph("phone", P["accent"], 26, 1.8))
        rl.addWidget(ic)
        nm = QLabel(f'<span style="font-size:17px">{name}</span>&nbsp;&nbsp;'
                    f'<span style="color:{P["muted"]}; font-size:13px">{ip}</span>')
        rl.addWidget(nm, 1)
        mark = QLabel()
        mark.setObjectName("mark")
        rl.addWidget(mark)
        it.setSizeHint(QSize(100, 50))
        self.found_list.addItem(it)
        self.found_list.setItemWidget(it, row)
        self.searching.setText(f"Найдено телефонов: {len(self.found)}")
        if self.found_list.currentRow() < 0:
            self.found_list.setCurrentRow(0)
        self._found_pick(self.found_list.currentRow())
        # телефон сменил адрес в сети — подхватываем новый
        ph = self.config["phone"]
        if ph and not self.online and ph.get("model") and ph["model"] in name and ph["host"] != ip:
            ph["host"] = ip
            self.config["phone"] = ph
            self.client = PhoneClient(ip, ph.get("port", PHONE_PORT), ph["token"])
            self.poll()

    def _found_pick(self, row):
        for i in range(self.found_list.count()):
            it = self.found_list.item(i)
            mark = self.found_list.itemWidget(it).findChild(QLabel, "mark")
            on = i == row
            pm = QPixmap(52, 52)
            pm.setDevicePixelRatio(2)
            pm.fill(Qt.transparent)
            mp = QPainter(pm)
            mp.setRenderHint(QPainter.Antialiasing)
            if on:
                mp.setPen(Qt.NoPen)
                mp.setBrush(QColor(P["accent"]))
                mp.drawEllipse(QRectF(1, 1, 24, 24))
                mp.drawPixmap(QRectF(5, 5, 16, 16).toRect(), glyph("check", "#FFFFFF", 16, 2.8))
            else:
                mp.setPen(QPen(QColor(P["line"]), 2))
                mp.drawEllipse(QRectF(2, 2, 22, 22))
            mp.end()
            mark.setPixmap(pm)
            if on:
                self.addr.setText(it.data(ROLE))

    def do_pair(self):
        host = self.addr.text().strip()
        pin = re.sub(r"\D", "", self.pin.value())
        if not host:
            self.pair_err.setText("Укажите адрес телефона или выберите его в списке.")
            return
        if len(pin) != 6:
            self.pair_err.setText("Код состоит из 6 цифр.")
            return
        self.pair_btn.setEnabled(False)
        self.pair_btn.setText("Подключаю…")
        self.pair_err.clear()
        c = PhoneClient(host)

        def work():
            hello = c.hello()
            if hello.get("app") != "RafLink":
                raise PhoneError("По этому адресу не RafLink")
            return c.pair(pin)

        run_bg(work, lambda r: self._paired(host, r), self._pair_failed)

    def _pair_failed(self, e):
        self.pair_btn.setEnabled(True)
        self.pair_btn.setText("Подключить")
        self.pair_err.setText(str(e))

    def _paired(self, host, r):
        self.pair_btn.setEnabled(True)
        self.pair_btn.setText("Подключить")
        name = r.get("name") or "Телефон"
        self.config["phone"] = {"host": host, "port": PHONE_PORT, "token": r["token"], "name": name,
                                "model": r.get("model", "")}
        self.client = PhoneClient(host, PHONE_PORT, r["token"])
        self.dev_name.setText(name)
        self.toast.result("Подключено", name, ok=True, hide_after=3500)
        self.online = False
        self.poll()

    # ---------- опрос телефона

    def poll(self):
        if self.client is None or self._polling:
            return
        self._polling = True
        run_bg(self.client.info, self._poll_ok, self._poll_fail)

    def _poll_ok(self, info):
        self._polling = False
        self._fails = 0
        self.info = info
        was = self.online
        self.online = True
        ph = self.config["phone"] or {}
        if info.get("name") and not ph.get("name_custom") and ph.get("name") != info["name"]:
            ph["name"] = info["name"]
            self.config["phone"] = ph
            self.dev_name.setText(info["name"])
        self.battery.set(int(info.get("battery") or 0), bool(info.get("charging")))
        self.batt.setText(f'{info.get("battery", "?")}%')
        self.batt.setToolTip(f'Свободно {human(info.get("free", 0))} из {human(info.get("total", 0))}')
        self._set_state(True)
        self.banner.setVisible(not info.get("files_access", True))
        self.tray.setToolTip(f"RafLink — {self.dev_name.text()}, {info.get('battery', '?')}%")
        if not was:
            if self.pages.currentIndex() in (3, 4):
                self.show_page("files")
            self.load(self.cur_path)
        if info.get("outbox") and not self._outbox_busy:
            self.fetch_outbox()

    def fetch_outbox(self):
        """Телефон положил файлы в очередь «на ПК» — забираем их во «Входящие»."""
        self._outbox_busy = True

        def ok(r):
            items = [dict(it, outbox_id=it["id"], path=None) for it in r.get("items", [])]
            if not items:
                self._outbox_busy = False
                return

            def then(res, err):
                self._outbox_busy = False
                if not err and res:
                    self._received_many(res)

            self.transfers.download(items, self.config.inbox(), then, kind="push")

        def fail(e):
            self._outbox_busy = False

        run_bg(self.client.outbox, ok, fail)

    def _poll_fail(self, e):
        self._polling = False
        if isinstance(e, PhoneError) and e.status == 401:
            self.online = False
            self.toast.result("Телефон забыл этот ПК", "Подключите его заново по коду.", ok=False)
            self.show_page("pair")
            return
        self._fails += 1
        if self.online and self._fails < 2:
            return  # одна осечка Wi-Fi — не повод пугать
        self.online = False
        self.batt.setText("")
        self.battery.set(-1, False)
        self._set_state(False)
        ph = self.config["phone"] or {}
        self.off_text.setText(f'Последний адрес телефона: {ph.get("host", "—")}. Жду, пока он появится в сети…')
        if self.pages.currentIndex() < 3:
            self.show_page("offline")

    # ---------- папки

    def load(self, path, remember=True):
        if self.client is None:
            return
        path = path.rstrip("/") or PHONE_ROOT
        if remember and path != self.cur_path and self.raw_entries is not None and self._loaded_once:
            self.back_stack.append(self.cur_path)
            del self.back_stack[:-50]
        self._loaded_once = True
        self.cur_path = path
        self._crumbs()
        for b, p in self.quick_btns:
            b.setChecked(p == self.cur_path)
        self.view.clear()
        self.empty.setText("Загружаю папку…")
        self.empty.show()
        self.view.hide()
        self.count_lbl.setText("")
        want = self.cur_path
        run_bg(lambda: self.client.list(want), lambda r: self._listed(want, r), lambda e: self._list_failed(want, e))

    def _listed(self, want, r):
        if want != self.cur_path:
            return
        base = r.get("path", want)
        self.raw_entries = [dict(it, path=base.rstrip("/") + "/" + it["name"]) for it in r.get("items", [])]
        self.search.blockSignals(True)
        self.search.clear()
        self.search.blockSignals(False)
        self.refilter()

    def _list_failed(self, want, e):
        if want != self.cur_path:
            return
        self.raw_entries = []
        self.view.clear()
        if isinstance(e, PhoneError) and e.status == 404 and want != PHONE_ROOT:
            self.empty.setText("Такой папки на телефоне нет.\nОткройте «Память телефона» вверху, чтобы выбрать другую.")
        else:
            self.empty.setText(str(e))
        self.empty.show()
        self.view.hide()

    def reload(self):
        if self.pages.currentIndex() == 1:
            self.load_albums()
        else:
            self.load(self.cur_path)

    def go_up(self):
        if self.cur_path != PHONE_ROOT:
            self.load(self.cur_path.rsplit("/", 1)[0])

    def go_back(self):
        if self.back_stack:
            self.load(self.back_stack.pop(), remember=False)
        else:
            self.go_up()

    def _crumbs(self):
        while self.crumbs.count():
            it = self.crumbs.takeAt(0)
            wd = it.widget()
            if wd and wd is not self.back_btn:
                wd.hide()
                wd.deleteLater()
        self.crumbs.addWidget(self.back_btn)
        self.back_btn.setEnabled(bool(self.back_stack) or self.cur_path != PHONE_ROOT)
        rel = self.cur_path[len(PHONE_ROOT):].strip("/")
        parts = [("Память телефона", PHONE_ROOT)]
        acc = PHONE_ROOT
        for s in [x for x in rel.split("/") if x]:
            acc += "/" + s
            parts.append((ru_name(s), acc))
        if len(parts) > 4:
            parts = parts[:1] + [("…", parts[-4][1])] + parts[-3:]
        for i, (t, p) in enumerate(parts):
            last = i == len(parts) - 1
            b = button(t, "crumblast" if last else "crumb", fn=lambda _=False, p=p: self.load(p))
            self.crumbs.addWidget(b)
            if not last:
                sep = QLabel()
                sep.setPixmap(glyph("chev", P["muted"], 14, 2))
                self.crumbs.addWidget(sep)
        self.crumbs.addStretch(1)

    def refilter(self):
        q = self.search.text().strip().lower()
        items = [e for e in self.raw_entries if q in e["name"].lower() or q in disp_name(e).lower()]
        mode = self.sort.currentIndex()
        if mode == 0:
            items.sort(key=lambda e: -(e.get("mtime") or 0))
        elif mode == 1:
            items.sort(key=lambda e: disp_name(e).lower())
        else:
            items.sort(key=lambda e: -(e.get("size") or 0))
        items.sort(key=lambda e: not e.get("dir"))
        self.view.set_entries(items)
        has = bool(items)
        self.view.setVisible(has)
        self.empty.setVisible(not has)
        if not has:
            self.empty.setText("Ничего не найдено" if q else "Папка пуста")
        self._sel_changed()

    def toggle_view(self):
        self.view.set_tiles(not self.view.tiles)
        self.view_btn.setIcon(QIcon(glyph("list" if self.view.tiles else "tiles", P["accent"])))
        self.view.viewport().update()

    def _sel_files(self):
        return [e for e in self.view.entries() if not e.get("dir")]

    def _sel_changed(self):
        files = self._sel_files()
        n = self.view.count()
        self.count_lbl.setText(f"Выбрано: {len(files)}" if files else f"Объектов: {n}")
        self.btn_open.setToolTip(self.count_lbl.text())
        self.btn_open.setEnabled(len(files) >= 1)
        self.btn_save.setEnabled(len(files) >= 1)

    def load_albums(self):
        if self.client is None:
            return
        self.photo_empty.setText("Загружаю альбомы…")
        self.photo_empty.show()
        self.photos.hide()

        def ok(r):
            cur = self.album_box.currentData()
            self.album_box.blockSignals(True)
            self.album_box.clear()
            self.album_box.addItem(f'Все фото · {r.get("total", 0)}', "all")
            for a in r.get("albums", []):
                self.album_box.addItem(f'{ru_name(a["name"])} · {a["count"]}', a["id"])
            i = self.album_box.findData(cur)
            self.album_box.setCurrentIndex(i if i >= 0 else 0)
            self.album_box.blockSignals(False)
            self.load_photos()

        def fail(e):
            self.photo_empty.setText(str(e))

        run_bg(self.client.albums, ok, fail)

    def load_photos(self):
        if self.client is None:
            return
        if self.album_box.count() == 0:
            self.load_albums()
            return
        album = self.album_box.currentData() or "all"
        self.photos.clear()
        self.photo_empty.setText("Загружаю фото…")
        self.photo_empty.show()
        self.photos.hide()

        def ok(r):
            if (self.album_box.currentData() or "all") != album:
                return
            items = r.get("items", [])
            self.photos.set_entries(items)
            self.photos.setVisible(bool(items))
            self.photo_empty.setVisible(not items)
            self.photo_empty.setText("В этом альбоме пусто")
            self.photo_count.setText(f"Фото и видео: {len(items)}")
            self._photo_sel()

        def fail(e):
            self.photo_empty.setText(str(e))

        run_bg(lambda: self.client.media(album), ok, fail)

    def _photo_sel(self):
        n = len(self.photos.selectedItems())
        self.photo_count.setText(f"Выбрано: {n}" if n else f"Фото и видео: {self.photos.count()}")
        self.photo_btn.setEnabled(n > 0)
        self.photo_btn.setText(f"На ПК · {n}" if n else "На ПК")

    # ---------- передачи

    def open_entries(self, files):
        files = [e for e in files if not e.get("dir")]
        if not files:
            return
        if len(files) > 5:
            files = files[:5]

        def then(res, err):
            if not err:
                for p in res:
                    open_local(p)
        self.transfers.download(files, None, then)

    def save_entries(self, files, ask=False):
        files = [e for e in files if not e.get("dir")]
        if not files:
            self.toast.message("Сначала выберите файлы")
            return
        dest = self.config.inbox()
        if ask:
            d = QFileDialog.getExistingDirectory(self, "Куда сохранить", str(dest))
            if not d:
                return
            dest = Path(d)
        self.transfers.download(files, dest)

    def pick_upload(self):
        paths, _ = QFileDialog.getOpenFileNames(self, "Файлы для отправки на телефон", str(Path.home()))
        self.upload_paths([Path(p) for p in paths])

    def upload_paths(self, paths):
        if not paths:
            return
        if not self.online:
            self.toast.result("Нет связи с телефоном", "Файлы не отправлены.", ok=False)
            return
        files = [p for p in paths if p.is_file()]
        if len(files) < len(paths):
            self.toast.message("Папки пока не отправляются — только файлы")
        if files:
            self.transfers.upload(files)

    def _transfer_done(self, direction, results, err):
        if err == "cancel":
            self.toast.result("Передача отменена", ok=False, hide_after=3500)
            return
        if err:
            self.toast.result("Ошибка передачи", err, ok=False)
            return
        if not results:
            self.toast.hide()
            return
        if direction == "push":
            return  # итог покажет _received_many
        if direction == "in":
            last = results[-1]
            in_cache = CACHE_DIR in last.parents
            if in_cache:
                self.toast.result("Готово", ok=True, hide_after=2500)
            else:
                text = last.name + (f" и ещё {len(results) - 1}" if len(results) > 1 else "")
                self.toast.result("Получено на ПК", text, ok=True,
                                  b1=("Открыть", lambda: open_local(last)),
                                  b2=("Показать в папке", lambda: show_in_folder(last)), hide_after=9000)
        else:
            text = results[-1].name + (f" и ещё {len(results) - 1}" if len(results) > 1 else "")
            self.toast.result("Отправлено на телефон", text + " → Загрузки/RafLink", ok=True, hide_after=6000)
            if self.cur_path.endswith("/Download/RafLink"):
                self.load(self.cur_path)
        if self.pages.currentIndex() == 2:
            self.fill_history()

    def _received_many(self, paths):
        last = paths[-1]
        text = last.name + (f" и ещё {len(paths) - 1}" if len(paths) > 1 else "")
        self._last_received = last
        self.toast.result("Получено с телефона", text, ok=True,
                          b1=("Открыть", lambda: open_local(last)),
                          b2=("Показать в папке", lambda: show_in_folder(last)), hide_after=12000)
        if not self.isVisible():
            self.tray.showMessage("Файл с телефона", text, QIcon(app_icon_pixmap()), 5000)
        if self.pages.currentIndex() == 2:
            self.fill_history()

    def fill_history(self):
        self.hist.clear()
        items = self.config["history"] or []
        if not items:
            it = QListWidgetItem("Передач пока не было")
            self.hist.addItem(it)
            return
        for n, h in enumerate(items[:150]):
            row = QWidget()
            rl = QHBoxLayout(row)
            rl.setContentsMargins(4, 8, 4, 8)
            rl.setSpacing(12)
            ic = QLabel()
            ic.setPixmap(type_icon({"name": h["name"]}, 36))
            rl.addWidget(ic, 0, Qt.AlignTop)
            col = QVBoxLayout()
            col.setSpacing(2)
            nm = label(h["name"], wrap=True)
            nm.setStyleSheet("font-weight:650; font-size:16px")
            col.addWidget(nm)
            arrow = "↓ Получено с телефона" if h["dir"] == "in" else "↑ Отправлено на телефон"
            col.addWidget(label(f'{arrow} · {human(h.get("size") or 0)} · {when(h["t"])}', "small"))
            local = Path(h.get("local") or "")
            btns = QHBoxLayout()
            btns.setSpacing(2)
            if local.exists():
                btns.addWidget(button("Открыть", "link", fn=lambda _=False, p=local: open_local(p)))
                btns.addWidget(button("Показать в папке", "link", fn=lambda _=False, p=local: show_in_folder(p)))
                if h["dir"] == "out":
                    btns.addWidget(button("Повторить", "link", fn=lambda _=False, p=local: self.upload_paths([p])))
            else:
                btns.addWidget(label("файл перемещён или удалён", "small"))
            btns.addStretch(1)
            col.addLayout(btns)
            rl.addLayout(col, 1)
            wrap = QWidget()
            wl = QVBoxLayout(wrap)
            wl.setContentsMargins(0, 0, 0, 0)
            wl.setSpacing(0)
            wl.addWidget(row)
            if n < min(len(items), 150) - 1:
                wl.addWidget(sep_line())
            it = QListWidgetItem()
            it.setSizeHint(QSize(100, wrap.sizeHint().height()))
            self.hist.addItem(it)
            self.hist.setItemWidget(it, wrap)

    # ---------- перетаскивание с ПК на окно

    def dragEnterEvent(self, ev):
        md = ev.mimeData()
        if md.hasUrls() and not md.hasFormat("application/x-raflink") and self.online:
            self.veil.setGeometry(self.centralWidget().rect().adjusted(10, 10, -10, -10))
            self.veil.show()
            self.veil.raise_()
            ev.acceptProposedAction()

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        if self.veil.isVisible():
            self.veil.setGeometry(self.centralWidget().rect().adjusted(10, 10, -10, -10))

    def keyPressEvent(self, ev):
        if ev.key() == Qt.Key_F5:
            self.reload()
            return
        if ev.key() == Qt.Key_Left and ev.modifiers() & Qt.AltModifier:
            self.go_back()
            return
        super().keyPressEvent(ev)

    def mousePressEvent(self, ev):
        if ev.button() == Qt.BackButton:
            self.go_back()
            return
        super().mousePressEvent(ev)

    # ---------- трей, мини-режим, настройки

    def _tray(self):
        self.tray = QSystemTrayIcon(QIcon(app_icon_pixmap()), self)
        m = QMenu()
        m.addAction("Открыть RafLink", self.show_normal)
        m.addAction(f"О программе (версия {APP_VER})", lambda: (self.show_normal(), self.about()))
        m.addAction(f"Написать автору: {APP_EMAIL}", mail_author)
        m.addAction("Мини-режим", self.to_mini)
        m.addAction("Папка «Входящие»", lambda: open_local(self.config.inbox()))
        m.addSeparator()
        m.addAction("Выход", self.quit)
        self.tray.setContextMenu(m)
        self.tray.activated.connect(lambda r: self.show_normal() if r in (QSystemTrayIcon.Trigger,
                                                                          QSystemTrayIcon.DoubleClick) else None)
        self.tray.messageClicked.connect(lambda: show_in_folder(getattr(self, "_last_received", self.config.inbox())))
        self.tray.setToolTip("RafLink")
        self.tray.show()

    def show_normal(self):
        self.capsule.hide()
        self.show()
        self.setWindowState(self.windowState() & ~Qt.WindowMinimized)
        self.raise_()
        self.activateWindow()

    def to_mini(self):
        self.hide()
        self.capsule.place()
        self.capsule.show()

    def closeEvent(self, ev):
        if getattr(self, "_quitting", False) or not QSystemTrayIcon.isSystemTrayAvailable():
            ev.accept()
            return
        ev.ignore()
        self.hide()
        if not self.config["hint_tray"]:
            self.config["hint_tray"] = True
            self.tray.showMessage("RafLink работает в фоне",
                                  "Файлы с телефона по-прежнему принимаются. Значок — у часов.",
                                  QIcon(app_icon_pixmap()), 5000)

    def quit(self):
        self._quitting = True
        self.tray.hide()
        self.capsule.hide()
        QApplication.quit()

    def about(self):
        AboutDialog(self).exec()

    def settings(self):
        d = SettingsDialog(self)
        d.exec()


def set_autostart(on: bool):
    if not IS_WIN:
        return
    import winreg
    key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run", 0,
                         winreg.KEY_SET_VALUE)
    try:
        if on:
            exe = sys.executable if getattr(sys, "frozen", False) else f'{sys.executable}" "{Path(__file__).resolve()}'
            winreg.SetValueEx(key, "RafLink", 0, winreg.REG_SZ, f'"{exe}" --tray')
        else:
            try:
                winreg.DeleteValue(key, "RafLink")
            except FileNotFoundError:
                pass
    finally:
        winreg.CloseKey(key)


def get_autostart() -> bool:
    if not IS_WIN:
        return False
    import winreg
    try:
        key = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Run")
        winreg.QueryValueEx(key, "RafLink")
        return True
    except OSError:
        return False


def mail_author():
    QDesktopServices.openUrl(QUrl(f"mailto:{APP_EMAIL}?subject=RafLink {APP_VER}"))


class AboutDialog(QDialog):
    def __init__(self, parent):
        super().__init__(parent)
        self.setWindowTitle("О программе RafLink")
        self.setFixedWidth(400)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 24, 24, 20)
        lay.setSpacing(6)
        ic = QLabel()
        pm = app_icon_pixmap(160)
        pm.setDevicePixelRatio(2)
        ic.setPixmap(pm)
        ic.setAlignment(Qt.AlignCenter)
        lay.addWidget(ic)
        t = label("RafLink", "h1")
        t.setAlignment(Qt.AlignCenter)
        lay.addWidget(t)
        v = label(f"Версия {APP_VER}", "muted")
        v.setAlignment(Qt.AlignCenter)
        v.setStyleSheet("font-size:16px")
        lay.addWidget(v)
        d = label("Телефон Android ↔ ПК по Wi-Fi: файлы, галерея и перетаскивание мышкой.", "muted", wrap=True)
        d.setAlignment(Qt.AlignCenter)
        lay.addSpacing(6)
        lay.addWidget(d)
        lay.addSpacing(10)
        c, cl = card(lay, (18, 14, 18, 14), 6)
        cl.addWidget(QLabel(f'Автор: <b>{APP_AUTHOR}</b>'))
        mail = QLabel(f'<a href="mailto:{APP_EMAIL}" style="color:{P["accent"]}; text-decoration:none">{APP_EMAIL}</a>')
        mail.setOpenExternalLinks(True)
        mail.setTextInteractionFlags(Qt.TextBrowserInteraction)
        cl.addWidget(mail)
        cl.addWidget(label(f"{APP_COPYRIGHT}. Все права защищены.", "small", wrap=True))
        cl.addWidget(label("Вопросы и предложения — пишите на почту.", "small", wrap=True))
        lay.addSpacing(10)
        lay.addWidget(button("Закрыть", "primary", fn=self.accept))


class SettingsDialog(QDialog):
    def __init__(self, win: MainWindow):
        super().__init__(win)
        self.win = win
        self.setWindowTitle("Настройки RafLink")
        self.setMinimumWidth(440)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(20, 18, 20, 18)
        lay.setSpacing(8)
        lay.addWidget(label("Настройки", "h2"))

        lay.addWidget(label("Папка «Входящие»", "label"))
        row = QHBoxLayout()
        self.inbox = QLineEdit(str(win.config.inbox()))
        row.addWidget(self.inbox, 1)
        row.addWidget(button("Обзор…", fn=self._browse))
        lay.addLayout(row)

        lay.addWidget(label("Имя телефона", "label"))
        self.pname = QLineEdit(win.dev_name.text())
        lay.addWidget(self.pname)

        lay.addWidget(label("Тема", "label"))
        self.theme = QComboBox()
        self.theme.addItems(["Тёмная", "Светлая"])
        self.theme.setCurrentIndex(0 if win.config["theme"] == "dark" else 1)
        self.old_theme = win.config["theme"] or "light"
        lay.addWidget(self.theme)

        self.auto = QCheckBox("Запускать вместе с Windows (в фоне, у часов)")
        self.auto.setChecked(get_autostart())
        self.auto.setEnabled(IS_WIN)
        lay.addWidget(self.auto)
        lay.addWidget(label("Файлы STEP/STL/DXF открываются программой, назначенной в Windows "
                            "(у вас — RafCAD View).", "small", wrap=True))

        note = QFrame()
        note.setObjectName("note")
        nl = QVBoxLayout(note)
        ph = win.config["phone"]
        nl.addWidget(label("Сопряжённый телефон", "h3"))
        nl.addWidget(label(f'{ph["name"]} · {ph["host"]}' if ph else "Телефонов пока нет", "muted"))
        r2 = QHBoxLayout()
        r2.addWidget(button("Подключить другой", fn=self._repair))
        if ph:
            r2.addWidget(button("Забыть телефон", fn=self._forget))
        r2.addStretch(1)
        nl.addLayout(r2)
        lay.addWidget(note)

        ab = button(f"О программе · RafLink {APP_VER} · {APP_AUTHOR}", "link", fn=lambda: (self.reject(), win.about()))
        lay.addWidget(ab)
        lay.addWidget(button(f"Связь с автором: {APP_EMAIL}", "link", fn=mail_author))
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(button("Отмена", fn=self.reject))
        row.addWidget(button("Сохранить", "primary", fn=self._save))
        lay.addLayout(row)

    def _browse(self):
        d = QFileDialog.getExistingDirectory(self, "Папка для файлов с телефона", self.inbox.text())
        if d:
            self.inbox.setText(d)

    def _repair(self):
        self.reject()
        self.win.show_page("pair")

    def _forget(self):
        if QMessageBox.question(self, "RafLink", "Забыть телефон? Для связи нужно будет снова ввести код.") \
                != QMessageBox.Yes:
            return
        self.win.config["phone"] = None
        self.win.client = None
        self.win.online = False
        self.win.dev_name.setText("Телефон")
        self.reject()
        self.win.show_page("pair")

    def _save(self):
        c = self.win.config
        c.data["inbox"] = self.inbox.text().strip() or default_inbox()
        ph = c["phone"]
        if ph and self.pname.text().strip():
            if ph.get("name") != self.pname.text().strip():
                ph["name_custom"] = True
            ph["name"] = self.pname.text().strip()
            c.data["phone"] = ph
            self.win.dev_name.setText(ph["name"])
        theme = "light" if self.theme.currentIndex() == 1 else "dark"
        c.data["theme"] = theme
        c.save()
        try:
            set_autostart(self.auto.isChecked())
        except Exception:
            pass
        self.accept()
        if theme != self.old_theme:
            restart()


def restart():
    """Перезапуск окна (смена темы перерисовывает все значки)."""
    from PySide6.QtCore import QProcess
    app = QApplication.instance()
    win = next((w for w in app.topLevelWidgets() if isinstance(w, MainWindow)), None)
    if win:
        win.quit()
    for srv in app.findChildren(QLocalServer):
        srv.close()
    args = sys.argv[1:] if getattr(sys, "frozen", False) else sys.argv
    QProcess.startDetached(sys.executable, [a for a in args if a != "--tray"])


def apply_theme(name: str):
    P.clear()
    P.update(PALETTES.get(name, PALETTES["dark"]))
    _glyph_cache.clear()
    QApplication.instance().setStyleSheet(qss())


# ---------------------------------------------------------------- запуск

def make_icon(out: str):
    """Сохранить значок программы (PNG) — из него сборка делает .ico."""
    QApplication.instance() or QApplication([])
    app_icon_pixmap(256).save(out)


def main():
    global BRIDGE
    args = sys.argv[1:]
    if IS_WIN:
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Sharapov.RafLink")
        except Exception:
            pass
    app = QApplication(sys.argv)
    if "--make-icon" in args:
        make_icon(args[args.index("--make-icon") + 1])
        return
    app.setApplicationName("RafLink")
    app.setQuitOnLastWindowClosed(False)
    f = QFont("Segoe UI Variable Text" if IS_WIN else "Inter")
    f.setPixelSize(15)
    app.setFont(f)

    # только одна копия программы
    # только одна копия; если запущена другая версия — она закрывается и уступает место этой
    for _ in range(20):
        sock = QLocalSocket()
        sock.connectToServer("RafLink-single")
        if not sock.waitForConnected(300):
            break
        sock.write(f"show {APP_VER}".encode())
        sock.flush()
        sock.waitForBytesWritten(300)
        sock.waitForReadyRead(1500)
        answer = bytes(sock.readAll()).decode(errors="ignore")
        sock.close()
        if answer != "bye":
            return  # та же версия уже работает — просто показали её окно
        time.sleep(0.5)
    QLocalServer.removeServer("RafLink-single")
    single = QLocalServer()
    single.listen("RafLink-single")

    BRIDGE = Bridge()
    config = Config()
    apply_theme(config["theme"] or "light")
    win = MainWindow(config)

    def on_peer():
        c = single.nextPendingConnection()
        if c is None:
            return

        def got():
            msg = bytes(c.readAll()).decode(errors="ignore")
            ver = msg.split(" ", 1)[1] if " " in msg else ""
            if ver and ver != APP_VER:
                c.write(b"bye")
                c.flush()
                c.waitForBytesWritten(500)
                win.quit()
            else:
                c.write(b"ok")
                c.flush()
                BRIDGE.show_window.emit()

        c.readyRead.connect(got)

    single.newConnection.connect(on_peer)

    if "--screenshot" in args:
        out = args[args.index("--screenshot") + 1]
        win.show()
        QTimer.singleShot(2500, lambda: (win.grab().save(out), app.quit()))
    elif "--tray" not in args:
        win.show()
    rc = app.exec()
    win.discovery(False, wait=True)
    sys.exit(rc)


if __name__ == "__main__":
    main()
