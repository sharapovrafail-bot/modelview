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
                               QProgressBar, QPushButton, QStackedWidget, QStyle,
                               QStyledItemDelegate, QSystemTrayIcon, QVBoxLayout, QWidget)

APP_VER = "0.2.2"
PHONE_PORT = 47700
IS_WIN = sys.platform == "win32"

CONFIG_DIR = Path(os.environ.get("APPDATA") or Path.home() / ".config") / "RafLink"
CONFIG_FILE = CONFIG_DIR / "config.json"
CACHE_DIR = Path(os.environ.get("TEMP") or "/tmp") / "RafLink" / "cache"
PHONE_ROOT = "/storage/emulated/0"

# ---------------------------------------------------------------- оформление (из прототипа)

PALETTES = {
    "dark": dict(bg="#0c1218", surface="#17212b", sub="#202e39", text="#eff5f8", muted="#b1c0cb",
                 accent="#65d4e5", ok="#78deb1", warn="#ffc07c", err="#ff9699", line="#36434e",
                 wash="#193840", on_accent="#0c2a31"),
    "light": dict(bg="#edf2f4", surface="#ffffff", sub="#edf2f5", text="#152634", muted="#4e626e",
                  accent="#006679", ok="#176942", warn="#903e00", err="#a12432", line="#c7d2d9",
                  wash="#d9eff1", on_accent="#ffffff"),
}
P = dict(PALETTES["dark"])

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
    "back": "M19 12H5 M12 19l-7-7 7-7",
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
    p.setBrush(QColor("#69d5e3"))
    p.setPen(Qt.NoPen)
    p.drawRoundedRect(QRectF(0, 0, size, size), size * 0.3, size * 0.3)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#092731" '
           f'stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="{PATHS["link"]}"/></svg>')
    QSvgRenderer(QByteArray(svg.encode())).render(p, QRectF(size * .16, size * .16, size * .68, size * .68))
    p.end()
    return pm


def qss() -> str:
    return f"""
    QWidget {{ color: {P['text']}; font-size: 15px; }}
    QMainWindow, QDialog, QWidget#root {{ background: {P['surface']}; }}
    QLabel {{ background: transparent; }}
    QLabel#muted, QLabel#small {{ color: {P['muted']}; }}
    QLabel#small {{ font-size: 13px; }}
    QLabel#label {{ color: {P['muted']}; font-size: 12px; font-weight: 600; }}
    QLabel#h2 {{ font-size: 21px; font-weight: 650; }}
    QLabel#h3 {{ font-size: 17px; font-weight: 650; }}
    QLabel#ok {{ color: {P['ok']}; font-size: 13px; }}
    QLabel#warn {{ color: {P['warn']}; font-size: 13px; }}
    QLabel#err {{ color: {P['err']}; }}
    QLabel#accent {{ color: {P['accent']}; }}
    QLabel#pin {{ font-family: Consolas, monospace; font-size: 30px; color: {P['accent']}; }}
    QWidget#device {{ background: {P['surface']}; }}
    QWidget#tabbar {{ background: {P['surface']}; border-bottom: 1px solid {P['line']}; }}
    QFrame#iconbox {{ background: {P['wash']}; border-radius: 10px; }}
    QFrame#note {{ background: {P['sub']}; border: 1px solid {P['line']}; border-radius: 12px; }}
    QFrame#banner {{ background: {P['wash']}; border: 1px solid {P['accent']}; border-radius: 12px; }}
    QFrame#toast {{ background: {P['sub']}; border: 1px solid {P['line']}; border-radius: 14px; }}
    QFrame#veil {{ background: {P['wash']}; border: 3px solid {P['accent']}; border-radius: 16px; }}
    QFrame#capsule {{ background: {P['wash']}; border: 1px solid {P['accent']}; border-radius: 28px; }}
    QPushButton {{ background: {P['sub']}; border: 1px solid {P['line']}; border-radius: 10px;
                   min-height: 36px; padding: 6px 12px; }}
    QPushButton:hover {{ border-color: {P['accent']}; }}
    QPushButton:focus {{ border: 2px solid {P['accent']}; }}
    QPushButton:disabled {{ color: {P['muted']}; }}
    QPushButton#pill {{ background: {P['wash']}; color: {P['accent']}; }}
    QPushButton#primary {{ background: {P['accent']}; color: {P['on_accent']}; border: 0; font-weight: 600;
                           min-height: 44px; }}
    QPushButton#icon {{ background: transparent; border: 0; min-height: 32px; padding: 4px 6px; }}
    QPushButton#icon:hover {{ background: {P['sub']}; }}
    QPushButton#tab {{ background: transparent; border: 0; border-radius: 0; color: {P['muted']};
                       border-bottom: 3px solid transparent; padding: 9px 4px; min-height: 30px; }}
    QPushButton#tab:checked {{ color: {P['accent']}; border-bottom: 3px solid {P['accent']}; }}
    QPushButton#quick {{ font-size: 14px; padding: 4px 2px; min-height: 34px; }}
    QPushButton#quick:checked {{ background: {P['wash']}; color: {P['accent']}; border-color: {P['accent']}; }}
    QPushButton#crumb {{ background: transparent; border: 0; padding: 2px 4px; min-height: 24px;
                         color: {P['muted']}; }}
    QPushButton#crumb:hover {{ color: {P['accent']}; }}
    QPushButton#crumblast {{ background: transparent; border: 0; padding: 2px 4px; min-height: 24px;
                             font-weight: 650; }}
    QLineEdit, QComboBox {{ background: {P['sub']}; border: 1px solid {P['line']}; border-radius: 9px;
                            padding: 7px 9px; min-height: 22px; }}
    QLineEdit:focus, QComboBox:focus {{ border: 2px solid {P['accent']}; }}
    QLineEdit#pinedit {{ font-family: Consolas, monospace; font-size: 26px; padding: 8px 12px; }}
    QComboBox QAbstractItemView {{ background: {P['surface']}; border: 1px solid {P['line']};
                                   selection-background-color: {P['wash']}; }}
    QListWidget {{ background: transparent; border: 0; outline: 0; }}
    QListWidget#plain::item {{ border-radius: 8px; padding: 8px; }}
    QListWidget#plain::item:selected {{ background: {P['wash']}; color: {P['text']}; }}
    QProgressBar {{ background: {P['line']}; border: 0; border-radius: 4px; max-height: 8px; }}
    QProgressBar::chunk {{ background: {P['accent']}; border-radius: 4px; }}
    QScrollBar:vertical {{ background: transparent; width: 10px; margin: 2px; }}
    QScrollBar::handle:vertical {{ background: {P['line']}; border-radius: 4px; min-height: 30px; }}
    QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; }}
    QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}
    QMenu {{ background: {P['surface']}; border: 1px solid {P['line']}; padding: 4px; }}
    QMenu::item {{ padding: 7px 22px; border-radius: 6px; }}
    QMenu::item:selected {{ background: {P['wash']}; }}
    QCheckBox {{ spacing: 10px; }}
    QToolTip {{ background: {P['surface']}; color: {P['text']}; border: 1px solid {P['line']}; }}
    """


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
        self.data = {"phone": None, "inbox": default_inbox(), "theme": "dark", "history": [],
                     "hint_tray": False}
        try:
            self.data.update(json.loads(CONFIG_FILE.read_text("utf-8")))
        except Exception:
            pass

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
        if self.view.tiles:
            return QSize(150, 156)
        return QSize(max(self.view.viewport().width() - 4, 200), 60)

    def paint(self, p: QPainter, opt, idx):
        e = idx.data(ROLE)
        if not e:
            return
        p.save()
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        r = QRectF(opt.rect).adjusted(2, 2, -2, -2)
        sel = bool(opt.state & QStyle.State_Selected)
        hover = bool(opt.state & QStyle.State_MouseOver)
        if sel:
            p.setBrush(QColor(P["wash"]))
            p.setPen(QPen(QColor(P["accent"]), 1.2))
            p.drawRoundedRect(r, 9, 9)
        elif hover:
            p.setBrush(QColor(P["sub"]))
            p.setPen(Qt.NoPen)
            p.drawRoundedRect(r, 9, 9)
        elif not self.view.tiles:
            p.setPen(QPen(QColor(P["line"]), 1))
            p.drawLine(r.bottomLeft() + QPoint(6, 1), r.bottomRight() + QPoint(-6, 1))

        k = kind_of(e)
        color = P["warn"] if k == "code" else P["accent"]
        gname = "folder" if k == "dir" else k
        thumb = self.view.thumbs.get(e["path"])
        meta = self.view.meta_text(e)
        name_font = QFont(opt.font)
        name_font.setPixelSize(15)
        name_font.setWeight(QFont.DemiBold)
        small = QFont(opt.font)
        small.setPixelSize(13)

        if self.view.tiles:
            box = QRectF(r.left() + 8, r.top() + 8, r.width() - 16, r.height() - 58)
        else:
            box = QRectF(r.left() + 6, r.center().y() - 19, 38, 38)
        path = QPainterPath()
        path.addRoundedRect(box, 10, 10)
        p.fillPath(path, QColor(P["wash"]))
        if thumb:
            p.setClipPath(path)
            sc = thumb.size().scaled(box.size().toSize(), Qt.KeepAspectRatioByExpanding)
            tr = QRectF(0, 0, sc.width(), sc.height())
            tr.moveCenter(box.center())
            p.drawPixmap(tr.toRect(), thumb)
            p.setClipping(False)
        else:
            gs = 34 if self.view.tiles else 22
            pm = glyph(gname, color, gs)
            p.drawPixmap(QRectF(box.center().x() - gs / 2, box.center().y() - gs / 2, gs, gs).toRect(), pm)

        p.setPen(QColor(P["text"]))
        if self.view.tiles:
            tx = QRectF(r.left() + 8, box.bottom() + 6, r.width() - 16, 20)
            p.setFont(name_font)
            p.drawText(tx, Qt.AlignLeft | Qt.AlignVCenter,
                       QFontMetrics(name_font).elidedText(disp_name(e), Qt.ElideMiddle, int(tx.width())))
            p.setFont(small)
            p.setPen(QColor(P["muted"]))
            p.drawText(QRectF(tx.left(), tx.bottom(), tx.width(), 18), Qt.AlignLeft | Qt.AlignVCenter,
                       QFontMetrics(small).elidedText(meta, Qt.ElideRight, int(tx.width())))
        else:
            tx = QRectF(box.right() + 12, r.top() + 9, r.width() - box.width() - 30, 21)
            p.setFont(name_font)
            p.drawText(tx, Qt.AlignLeft | Qt.AlignVCenter,
                       QFontMetrics(name_font).elidedText(disp_name(e), Qt.ElideMiddle, int(tx.width())))
            p.setFont(small)
            p.setPen(QColor(P["muted"]))
            p.drawText(QRectF(tx.left(), tx.bottom() + 1, tx.width(), 19), Qt.AlignLeft | Qt.AlignVCenter, meta)
        p.restore()


class FileView(QListWidget):
    """Файлы телефона. Перетаскивание наружу = скачать и отдать Проводнику."""
    open_dir = Signal(str)

    def __init__(self, app: "MainWindow"):
        super().__init__()
        self.app = app
        self.tiles = False
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

    def set_tiles(self, on: bool):
        self.tiles = on
        if on:
            self.setViewMode(QListWidget.IconMode)
            self.setGridSize(QSize(154, 160))
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
        return f'{x} · {human(e.get("size") or 0)} · {datetime.fromtimestamp(e.get("mtime") or 0):%d.%m.%y %H:%M}'

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
    f.setPixelSize(14)
    f.setWeight(QFont.DemiBold)
    fm = QFontMetrics(f)
    text = fm.elidedText(text, Qt.ElideMiddle, 240)
    w, h = fm.horizontalAdvance(text) + 58, 40
    pm = QPixmap(w * 2, h * 2)
    pm.setDevicePixelRatio(2)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.setBrush(QColor(P["surface"]))
    p.setPen(QPen(QColor(P["accent"]), 1.5))
    p.drawRoundedRect(QRectF(1, 1, w - 2, h - 2), 12, 12)
    k = kind_of(files[0])
    p.drawPixmap(10, 9, glyph(k if k != "dir" else "folder", P["warn"] if k == "code" else P["accent"], 22))
    p.setFont(f)
    p.setPen(QColor(P["text"]))
    p.drawText(QRectF(42, 0, w - 50, h), Qt.AlignVCenter, text)
    p.end()
    return pm


# ---------------------------------------------------------------- панель передачи (тост)

class Toast(QFrame):
    def __init__(self, app: "MainWindow"):
        super().__init__()
        self.app = app
        self.setObjectName("toast")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(14, 10, 14, 12)
        lay.setSpacing(6)
        row = QHBoxLayout()
        self.title = label("", "h3")
        self.title.setStyleSheet("font-size:15px")
        row.addWidget(self.title, 1)
        self.bx = button("✕", "icon", fn=self.hide)
        row.addWidget(self.bx)
        lay.addLayout(row)
        self.name = label("", wrap=True)
        lay.addWidget(self.name)
        brow = QHBoxLayout()
        self.b1 = button("", "pill")
        self.b2 = button("")
        brow.addWidget(self.b1)
        brow.addWidget(self.b2)
        brow.addStretch(1)
        self.bar = QProgressBar()
        self.bar.setFixedHeight(8)
        self.bar.setTextVisible(False)
        self.bar.setRange(0, 1000)
        lay.addWidget(self.bar)
        self.sub = label("", "small")
        lay.addWidget(self.sub)
        lay.addLayout(brow)
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
        self.title.setStyleSheet("font-size:15px")
        self.title.setText({"in": "Телефон → ПК", "push": "Принимаю с телефона", "out": "ПК → Телефон"}[direction])
        self.name.setText(first + (f"  +{count - 1}" if count > 1 else ""))
        self.name.show()
        self.bar.setValue(0)
        self.bar.show()
        self.sub.setText("Начинаю передачу…")
        self.sub.show()
        self._btn(self.b1, "", None)
        self._btn(self.b2, "Отмена", self.app.transfers.cancel)
        self.bx.hide()
        self.show()

    def progress(self, done, total, speed):
        self.bar.setValue(int(done * 1000 / max(total, 1)))
        if speed > 0:
            left = (total - done) / speed
            self.sub.setText(f"{human(done)} из {human(total)} · {human(speed)}/с · осталось {max(1, int(left))} с")

    def result(self, title, text="", ok=True, b1=None, b2=None, hide_after=0):
        self._timer.stop()
        self.title.setText(title)
        self.title.setStyleSheet(f"font-size:15px; color:{P['ok'] if ok else P['err']}")
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
        self.result(text, ok=ok, hide_after=4500)
        if not ok:
            self.title.setStyleSheet("font-size:15px")


# ---------------------------------------------------------------- подложка «Отпустите»

class Veil(QFrame):
    dropped = Signal(list)

    def __init__(self, parent):
        super().__init__(parent)
        self.setObjectName("veil")
        self.setAcceptDrops(True)
        lay = QVBoxLayout(self)
        lay.setAlignment(Qt.AlignCenter)
        ic = QLabel()
        ic.setPixmap(glyph("up", P["accent"], 48, 2))
        ic.setAlignment(Qt.AlignCenter)
        lay.addWidget(ic)
        t = label("Отпустите — отправлю на телефон", "h2", wrap=True)
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

        self.setWindowTitle("RafLink")
        self.setWindowIcon(QIcon(app_icon_pixmap()))
        self.resize(500, 800)
        self.setMinimumSize(420, 560)
        self.setAcceptDrops(True)

        root = QWidget()
        root.setObjectName("root")
        self.setCentralWidget(root)
        v = QVBoxLayout(root)
        v.setContentsMargins(0, 0, 0, 0)
        v.setSpacing(0)

        # шапка: телефон, статус, заряд
        dev = QWidget()
        dev.setObjectName("device")
        h = QHBoxLayout(dev)
        h.setContentsMargins(16, 14, 10, 12)
        h.setSpacing(12)
        h.addWidget(icon_box("phone", P["accent"]))
        col = QVBoxLayout()
        col.setSpacing(0)
        self.dev_name = label("Телефон", "h3")
        self.dev_state = label("● Нет связи", "warn")
        col.addWidget(self.dev_name)
        col.addWidget(self.dev_state)
        h.addLayout(col, 1)
        self.batt = label("", "muted")
        h.addWidget(self.batt)
        h.addWidget(button("", "icon", icon="mini", tip="Мини-режим: капсула для файлов", fn=self.to_mini))
        h.addWidget(button("", "icon", icon="gear", tip="Настройки", fn=self.settings))
        v.addWidget(dev)

        # вкладки
        tb = QWidget()
        tb.setObjectName("tabbar")
        th = QHBoxLayout(tb)
        th.setContentsMargins(12, 0, 12, 0)
        th.setSpacing(2)
        self.tab_btns = []
        for i, t in enumerate(["Файлы", "Галерея", "История"]):
            b = button(t, "tab", fn=lambda _=False, i=i: self.switch_tab(i))
            b.setCheckable(True)
            th.addWidget(b, 1)
            self.tab_btns.append(b)
        self.tabbar = tb
        v.addWidget(tb)

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

        tw = QWidget()
        tl = QVBoxLayout(tw)
        tl.setContentsMargins(12, 0, 12, 12)
        self.toast = Toast(self)
        tl.addWidget(self.toast)
        v.addWidget(tw)

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
        lay = QVBoxLayout(w)
        lay.setContentsMargins(16, 14, 16, 10)
        lay.setSpacing(8)
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
        lay.addWidget(label("Быстрые папки", "label"))
        grid = QGridLayout()
        grid.setSpacing(6)
        self.quick_btns = []
        for i, (t, ic, sub) in enumerate(QUICK):
            b = button(t, "quick", fn=lambda _=False, sub=sub: self.load(PHONE_ROOT + "/" + sub))
            b.setIcon(QIcon(glyph(ic, P["accent"], 22)))
            b.setIconSize(QSize(22, 22))
            b.setCheckable(True)
            grid.addWidget(b, i // 3, i % 3)
            self.quick_btns.append((b, PHONE_ROOT + "/" + sub))
        lay.addLayout(grid)

        self.crumbs = QHBoxLayout()
        self.crumbs.setSpacing(0)
        self.crumbs.setContentsMargins(0, 0, 0, 0)
        self.back_btn = button("", "icon", icon="back", tip="Назад (Alt+←, Backspace)", fn=self.go_back)
        self.up_btn = button("", "icon", icon="up", tip="На уровень выше", fn=self.go_up)
        cw = QWidget()
        cw.setLayout(self.crumbs)
        lay.addWidget(cw)

        tools = QHBoxLayout()
        tools.setSpacing(6)
        self.search = QLineEdit()
        self.search.setPlaceholderText("Поиск файлов")
        self.search.setClearButtonEnabled(True)
        self.search.textChanged.connect(self.refilter)
        tools.addWidget(self.search, 1)
        self.sort = QComboBox()
        self.sort.addItems(["Сначала новые", "По имени", "По размеру"])
        self.sort.currentIndexChanged.connect(self.refilter)
        tools.addWidget(self.sort)
        self.view_btn = button("", icon="tiles", tip="Список или плитка", fn=self.toggle_view)
        tools.addWidget(self.view_btn)
        tools.addWidget(button("", icon="refresh", tip="Обновить (F5)", fn=self.reload))
        lay.addLayout(tools)

        self.view = FileView(self)
        self.view.open_dir.connect(self.load)
        self.view.itemSelectionChanged.connect(self._sel_changed)
        lay.addWidget(self.view, 1)
        self.empty = label("", "muted")
        self.empty.setAlignment(Qt.AlignCenter)
        self.empty.hide()
        lay.addWidget(self.empty, 1)

        foot = QHBoxLayout()
        self.count_lbl = label("", "small")
        foot.addWidget(self.count_lbl, 1)
        self.btn_open = button("Открыть", fn=lambda: self.open_entries(self._sel_files()))
        self.btn_save = button("На ПК", "pill", icon="down",
                               tip="Сохранить выбранные в папку «Входящие»",
                               fn=lambda: self.save_entries(self._sel_files()))
        self.btn_send = button("На телефон", icon="send", tip="Выбрать файлы на ПК и отправить на телефон",
                               fn=self.pick_upload)
        foot.addWidget(self.btn_open)
        foot.addWidget(self.btn_save)
        foot.addWidget(self.btn_send)
        lay.addLayout(foot)
        self.view.setToolTip("Перетащите файл мышкой в Проводник или на рабочий стол.\n"
                             "Обратно — бросьте файл с ПК на это окно.")
        return w

    def _build_photos(self):
        w, lay = self._page()
        top = QHBoxLayout()
        top.addWidget(label("Галерея", "h2"), 1)
        top.addWidget(button("", icon="refresh", tip="Обновить", fn=self.load_albums))
        lay.addLayout(top)
        self.album_box = QComboBox()
        self.album_box.currentIndexChanged.connect(self.load_photos)
        lay.addWidget(self.album_box)
        self.photos = FileView(self)
        self.photos.set_tiles(True)
        self.photos.itemSelectionChanged.connect(self._photo_sel)
        lay.addWidget(self.photos, 1)
        self.photo_empty = label("", "muted")
        self.photo_empty.setAlignment(Qt.AlignCenter)
        self.photo_empty.setWordWrap(True)
        self.photo_empty.hide()
        lay.addWidget(self.photo_empty, 1)
        foot = QHBoxLayout()
        self.photo_count = label("", "small")
        foot.addWidget(self.photo_count, 1)
        foot.addWidget(button("Сохранить выбранные на ПК", "pill", icon="down",
                              fn=lambda: self.save_entries(self.photos.entries())))
        lay.addLayout(foot)
        return w

    def _build_history(self):
        w, lay = self._page()
        top = QHBoxLayout()
        top.addWidget(label("История передач", "h2"), 1)
        top.addWidget(button("Папка «Входящие»", icon="folder", fn=lambda: open_local(self.config.inbox())))
        lay.addLayout(top)
        self.hist = QListWidget()
        self.hist.setVerticalScrollMode(QAbstractItemView.ScrollPerPixel)
        self.hist.setSelectionMode(QAbstractItemView.NoSelection)
        lay.addWidget(self.hist, 1)
        return w

    def _build_offline(self):
        w, lay = self._page()
        lay.addStretch(1)
        ic = QLabel()
        ic.setPixmap(glyph("wifi", P["warn"], 56, 1.6))
        ic.setAlignment(Qt.AlignCenter)
        lay.addWidget(ic)
        t = label("Нет связи с телефоном", "h2")
        t.setAlignment(Qt.AlignCenter)
        lay.addWidget(t)
        self.off_text = label("", "muted", wrap=True)
        self.off_text.setAlignment(Qt.AlignCenter)
        lay.addWidget(self.off_text)
        note = QFrame()
        note.setObjectName("note")
        nl = QVBoxLayout(note)
        for s in ["1. Телефон и ПК подключены к одной сети Wi-Fi.",
                  "2. На телефоне открыто приложение RafLink (в шторке — «На связи…»).",
                  "3. Xiaomi: RafLink → «Работа в фоне без ограничений» и «Автозапуск»."]:
            nl.addWidget(label(s, wrap=True))
        lay.addWidget(note)
        row = QHBoxLayout()
        row.addWidget(button("Повторить", "primary", fn=self.poll), 1)
        row.addWidget(button("Подключить другой телефон", fn=lambda: self.show_page("pair")), 1)
        lay.addLayout(row)
        lay.addStretch(2)
        return w

    def _build_pair(self):
        w, lay = self._page()
        lay.addWidget(label("Первое подключение", "h2"))
        note = QFrame()
        note.setObjectName("note")
        nl = QVBoxLayout(note)
        for s in ["1. Установите на телефон приложение RafLink и откройте его.",
                  "2. Подключите телефон к той же сети Wi-Fi, что и компьютер.",
                  "3. Выберите телефон ниже и введите 6-значный код с его экрана."]:
            nl.addWidget(label(s, wrap=True))
        lay.addWidget(note)
        lay.addWidget(label("Телефоны в сети", "label"))
        self.found_list = QListWidget()
        self.found_list.setObjectName("plain")
        self.found_list.setMaximumHeight(150)
        self.found_list.itemClicked.connect(lambda it: self.addr.setText(it.data(ROLE)))
        lay.addWidget(self.found_list)
        self.searching = label("Ищу телефон…", "accent")
        lay.addWidget(self.searching)
        lay.addWidget(label("Адрес телефона", "label"))
        self.addr = QLineEdit()
        self.addr.setPlaceholderText("например 192.168.1.34 — виден на экране RafLink")
        lay.addWidget(self.addr)
        lay.addWidget(label("Код с экрана телефона", "label"))
        self.pin = QLineEdit()
        self.pin.setObjectName("pinedit")
        self.pin.setPlaceholderText("000 000")
        self.pin.setMaxLength(7)
        self.pin.returnPressed.connect(self.do_pair)
        lay.addWidget(self.pin)
        self.pair_err = label("", "err", wrap=True)
        lay.addWidget(self.pair_err)
        self.pair_btn = button("Подключить", "primary", fn=self.do_pair)
        lay.addWidget(self.pair_btn)
        self.pair_cancel = button("Отмена", fn=lambda: self.show_page("files" if self.online else "offline"))
        lay.addWidget(self.pair_cancel)
        lay.addStretch(1)
        return w

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
            self.pin.setFocus()
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
        it = QListWidgetItem(QIcon(glyph("phone", P["accent"], 20)), f"{name}   ·   {ip}")
        it.setData(ROLE, ip)
        self.found_list.addItem(it)
        self.searching.setText(f"Найдено телефонов: {len(self.found)}")
        if not self.addr.text():
            self.addr.setText(ip)
        # телефон сменил адрес в сети — подхватываем новый
        ph = self.config["phone"]
        if ph and not self.online and ph.get("model") and ph["model"] in name and ph["host"] != ip:
            ph["host"] = ip
            self.config["phone"] = ph
            self.client = PhoneClient(ip, ph.get("port", PHONE_PORT), ph["token"])
            self.poll()

    def do_pair(self):
        host = self.addr.text().strip()
        pin = re.sub(r"\D", "", self.pin.text())
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
        ch = " ⚡" if info.get("charging") else ""
        self.batt.setText(f'{info.get("battery", "?")}%{ch}')
        self.batt.setToolTip(f'Свободно {human(info.get("free", 0))} из {human(info.get("total", 0))}')
        self.dev_state.setText("● Подключено")
        self.dev_state.setObjectName("ok")
        self.dev_state.setStyleSheet(f"color:{P['ok']}; font-size:13px")
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
        self.dev_state.setText("● Нет связи")
        self.dev_state.setStyleSheet(f"color:{P['warn']}; font-size:13px")
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
            if wd and wd not in (self.back_btn, self.up_btn):
                wd.hide()
                wd.deleteLater()
        self.crumbs.addWidget(self.back_btn)
        self.crumbs.addWidget(self.up_btn)
        self.back_btn.setEnabled(bool(self.back_stack))
        self.up_btn.setEnabled(self.cur_path != PHONE_ROOT)
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
                sep = label("›", "muted")
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

    def _sel_files(self):
        return [e for e in self.view.entries() if not e.get("dir")]

    def _sel_changed(self):
        files = self._sel_files()
        n = self.view.count()
        self.count_lbl.setText(f"Выбрано: {len(files)}" if files else f"Объектов: {n}")
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
            self.album_box.addItem(QIcon(glyph("gallery", P["accent"])), f'Все фото и видео  ·  {r.get("total", 0)}', "all")
            for a in r.get("albums", []):
                ic = "cam" if a["name"] == "Camera" else "shot" if "Screenshot" in a["name"] else "folder"
                self.album_box.addItem(QIcon(glyph(ic, P["accent"])), f'{ru_name(a["name"])}  ·  {a["count"]}', a["id"])
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

        def fail(e):
            self.photo_empty.setText(str(e))

        run_bg(lambda: self.client.media(album), ok, fail)

    def _photo_sel(self):
        n = len(self.photos.selectedItems())
        self.photo_count.setText(f"Выбрано: {n}" if n else f"Фото и видео: {self.photos.count()}")

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
        for h in items[:150]:
            card = QFrame()
            card.setObjectName("note")
            cl = QVBoxLayout(card)
            cl.setContentsMargins(12, 10, 12, 10)
            cl.setSpacing(3)
            arrow = "Телефон → ПК" if h["dir"] == "in" else "ПК → Телефон"
            cl.addWidget(label(f'{when(h["t"])} · {arrow} · {human(h.get("size") or 0)}', "small"))
            nm = label(h["name"], wrap=True)
            nm.setStyleSheet("font-weight:600")
            cl.addWidget(nm)
            local = Path(h.get("local") or "")
            row = QHBoxLayout()
            ob = button("Открыть", fn=lambda _=False, p=local: open_local(p) if p.exists() else None)
            fb = button("Показать в папке", fn=lambda _=False, p=local: show_in_folder(p))
            ob.setEnabled(local.exists())
            fb.setEnabled(local.exists())
            row.addWidget(ob)
            row.addWidget(fb)
            if h["dir"] == "out" and local.exists():
                row.addWidget(button("Повторить", fn=lambda _=False, p=local: self.upload_paths([p])))
            row.addStretch(1)
            cl.addLayout(row)
            it = QListWidgetItem()
            it.setSizeHint(QSize(100, card.sizeHint().height() + 8))
            self.hist.addItem(it)
            self.hist.setItemWidget(it, card)

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
        self.theme.setCurrentIndex(0 if win.config["theme"] != "light" else 1)
        self.old_theme = win.config["theme"] or "dark"
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

        lay.addWidget(label(f"RafLink {APP_VER} · Рафаил Шарапов", "small"))
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
    apply_theme(config["theme"] or "dark")
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
