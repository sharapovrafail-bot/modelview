"""RafChat — чат и передача файлов по локальной сети организации, без сервера.

Каждый ПК/телефон раз в несколько секунд сообщает в сеть «я здесь» (UDP 47800) и принимает
сообщения и файлы на своём порту (TCP 47801). Все участники вводят один «код организации»:
им подписываются все пакеты и запросы — чужие устройства в сети не видны и подделать сообщение не могут.
Сообщение выключенному получателю ждёт в очереди у отправителя и уходит, когда тот появится.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import ipaddress
import json
import os
import socket
import sqlite3
import sys
import threading
import time
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

from PySide6.QtCore import QObject, QPoint, QRectF, QSize, Qt, QTimer, QUrl, Signal
from PySide6.QtGui import QColor, QDesktopServices, QFont, QIcon, QPainter, QPixmap, QTextOption
from PySide6.QtNetwork import QLocalServer, QLocalSocket
from PySide6.QtWidgets import (QApplication, QComboBox, QDateEdit, QDialog, QFileDialog, QFrame, QHBoxLayout,
                               QLabel, QLineEdit, QListWidget, QListWidgetItem, QMainWindow, QMenu, QMessageBox,
                               QPlainTextEdit, QProgressBar, QScrollArea, QSizePolicy, QSpinBox, QSystemTrayIcon,
                               QVBoxLayout, QWidget)

import common as C
from common import P, button, card, glyph, human, label, open_local, show_in_folder, type_icon

APP_VER = "0.5.1"
APP_AUTHOR = "Рафаил Шарапов"
APP_EMAIL = "rafail@sharapov-cnc.ru"
APP_COPYRIGHT = "© 2026 Рафаил Шарапов"
IS_WIN = sys.platform == "win32"

UDP_PORT = int(os.environ.get("RAFCHAT_UDP") or 47800)
TCP_PORT = int(os.environ.get("RAFCHAT_PORT") or 47801)
DATA_DIR = Path(os.environ.get("RAFCHAT_HOME") or
                Path(os.environ.get("APPDATA") or Path.home() / ".config") / "RafChat")
AUTO_DOWNLOAD = 50 * 1024 * 1024        # файлы до 50 МБ скачиваются сами
RELAY_FILE_MAX = 50 * 1024 * 1024       # через сервер — файлы до 50 МБ
RELAY_ONLINE_SEC = 75                   # «в сети через интернет», если опрашивал сервер не позже 75 с назад
ONLINE_SEC = 15                         # «в сети», если маяк был не позже 15 с назад
ALL = "all"


def default_downloads() -> Path:
    return Path.home() / "Downloads" / "RafChat"


def now_ms() -> int:
    return int(time.time() * 1000)


def initials(name: str) -> str:
    parts = [p for p in name.replace(".", " ").split() if p]
    return ("".join(p[0] for p in parts[:2]) or "?").upper()


AVATAR_COLORS = ["#FF9500", "#34C759", "#AF52DE", "#FF2D55", "#5AC8FA", "#FF3B30", "#5856D6", "#30B0C7"]


def avatar_color(key: str) -> str:
    return AVATAR_COLORS[int(hashlib.md5(key.encode()).hexdigest(), 16) % len(AVATAR_COLORS)]


def avatar(name: str, key: str, size=40, group=False, photo: str | None = None) -> QPixmap:
    pm = QPixmap(size * 2, size * 2)
    pm.setDevicePixelRatio(2)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.setRenderHint(QPainter.SmoothPixmapTransform)
    p.setPen(Qt.NoPen)
    img = QPixmap(photo) if photo and Path(photo).is_file() else None
    if img is not None and not img.isNull():
        from PySide6.QtGui import QPainterPath
        path = QPainterPath()
        path.addEllipse(QRectF(0, 0, size, size))
        p.setClipPath(path)
        p.drawPixmap(QRectF(0, 0, size, size).toRect(), img)
        p.end()
        return pm
    p.setBrush(QColor(P["accent"] if group else avatar_color(key)))
    p.drawEllipse(QRectF(0, 0, size, size))
    if group:
        g = int(size * 0.56)
        p.drawPixmap(int((size - g) / 2), int((size - g) / 2), glyph("users", "#FFFFFF", g, 2))
    else:
        f = QFont()
        f.setPixelSize(int(size * 0.38))
        f.setWeight(QFont.DemiBold)
        p.setFont(f)
        p.setPen(QColor("#FFFFFF"))
        p.drawText(QRectF(0, 0, size, size), Qt.AlignCenter, initials(name))
    p.end()
    return pm


AVATAR_DIR = DATA_DIR / "avatars"
MY_AVATAR = DATA_DIR / "avatar.jpg"


def peer_photo(pid: str) -> str | None:
    f = AVATAR_DIR / f"{pid}.jpg"
    return str(f) if f.is_file() else None


def make_avatar_jpeg(src: str) -> bytes | None:
    """Фото → квадрат по центру 256×256 → JPEG (~15–25 КБ)."""
    from PySide6.QtCore import QBuffer, QByteArray, QIODevice
    from PySide6.QtGui import QImage
    img = QImage(src)
    if img.isNull():
        return None
    side = min(img.width(), img.height())
    img = img.copy((img.width() - side) // 2, (img.height() - side) // 2, side, side)
    img = img.scaled(256, 256, Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
    ba = QByteArray()
    buf = QBuffer(ba)
    buf.open(QIODevice.WriteOnly)
    img.save(buf, "JPG", 85)
    return bytes(ba)


# ======================================================================= сеть (без интерфейса)

class Store:
    """Переписка и участники — в SQLite."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.lock = threading.RLock()
        with self.lock:
            self.db.executescript("""
            CREATE TABLE IF NOT EXISTS peers(id TEXT PRIMARY KEY, name TEXT, dept TEXT, ip TEXT, port INT,
                plat TEXT, last_seen REAL);
            CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, chat TEXT, sender TEXT, sender_name TEXT,
                ts INT, text TEXT, file TEXT, mine INT, status TEXT, local TEXT, unread INT DEFAULT 0);
            CREATE INDEX IF NOT EXISTS msg_chat ON messages(chat, ts);
            CREATE TABLE IF NOT EXISTS outbox(peer TEXT, msg_id TEXT, payload TEXT, PRIMARY KEY(peer, msg_id));
            CREATE TABLE IF NOT EXISTS files(fid TEXT PRIMARY KEY, path TEXT);
            """)
            for col in ("relay_seen REAL DEFAULT 0", "avh TEXT"):
                try:
                    self.db.execute("ALTER TABLE peers ADD COLUMN " + col)
                except sqlite3.OperationalError:
                    pass
            for col in ("reply TEXT", "task TEXT"):          # ответ на сообщение; карточка задания
                try:
                    self.db.execute("ALTER TABLE messages ADD COLUMN " + col)
                except sqlite3.OperationalError:
                    pass
            # поиск без учёта регистра и для русских букв (встроенный LIKE понимает только латиницу)
            self.db.create_function("lowr", 1, lambda v: (v or "").lower(), deterministic=True)
            self.db.commit()

    def q(self, sql, args=(), one=False):
        with self.lock:
            cur = self.db.execute(sql, args)
            rows = cur.fetchall()
            self.db.commit()
            return (rows[0] if rows else None) if one else rows


class Node(QObject):
    """Участник сети: маяк, приём сообщений и файлов, очередь доставки."""
    peers_changed = Signal()
    message = Signal(str, bool)              # id сообщения, новое ли (а не смена статуса)
    task_changed = Signal(str, str, str)     # id задания, кто сменил, новый статус
    file_progress = Signal(str, int, int)    # id сообщения, принято, всего

    def __init__(self, cfg: dict):
        super().__init__()
        self.cfg = cfg
        self.id = cfg["id"]
        org = cfg["org"].strip()
        self.key = hashlib.sha256(("RafChat:" + org).encode()).digest()
        # шифрование «от устройства до устройства» для сервера: сервер видит только шифротекст
        self.ekey = hashlib.sha256(("RafChat-e2e:" + org).encode()).digest()
        self.org_id = hashlib.sha256(("RafChat-org:" + org).encode()).hexdigest()[:32]
        self.relay_ok = None                 # None — сервер не задан, True/False — есть ли связь
        self._av_loading: set = set()
        alt = cfg.get("relay_alt") or [None, False]       # запомненный рабочий порт сервера (мобильный интернет)
        self._alt_port, self._alt_tls = alt[0], bool(alt[1])
        self._av_fail: dict = {}
        self._relay_uploaded: set = set()
        self.store = Store(DATA_DIR / "rafchat.db")
        self._downloading: set = set()
        self._wake = threading.Event()
        self.running = True

    # ---------- шифрование для сервера (AES-256-GCM: 12 байт nonce + шифротекст + тег)
    def enc(self, data: bytes) -> bytes:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        n = os.urandom(12)
        return n + AESGCM(self.ekey).encrypt(n, data, None)

    def dec(self, blob: bytes) -> bytes:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        return AESGCM(self.ekey).decrypt(blob[:12], blob[12:], None)

    # ---------- подписи
    def sign(self, data: bytes) -> str:
        return hmac.new(self.key, data, hashlib.sha256).hexdigest()

    def auth_header(self, method: str, path: str, body: bytes = b"") -> str:
        ts = str(int(time.time()))
        return ts + ":" + self.sign(f"{ts}:{method}:{path}:".encode() + hashlib.sha256(body).hexdigest().encode())

    def check_auth(self, header: str, method: str, path: str, body: bytes = b"") -> bool:
        try:
            ts, sig = header.split(":", 1)
            if abs(time.time() - int(ts)) > 86400:
                return False
            good = self.sign(f"{ts}:{method}:{path}:".encode() + hashlib.sha256(body).hexdigest().encode())
            return hmac.compare_digest(sig, good)
        except Exception:
            return False

    # ---------- запуск
    def start(self):
        node = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def _reply(self, code, obj):
                b = json.dumps(obj, ensure_ascii=False).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(b)))
                self.end_headers()
                self.wfile.write(b)

            def do_GET(self):
                if not node.check_auth(self.headers.get("X-Auth", ""), "GET", self.path):
                    return self._reply(401, {"error": "auth"})
                u = urlparse(self.path)
                q = {k: v[0] for k, v in parse_qs(u.query).items()}
                if u.path == "/ping":
                    return self._reply(200, node.profile())
                if u.path == "/avatar":
                    if not MY_AVATAR.is_file():
                        return self._reply(404, {"error": "not_found"})
                    b = MY_AVATAR.read_bytes()
                    self.send_response(200)
                    self.send_header("Content-Type", "image/jpeg")
                    self.send_header("Content-Length", str(len(b)))
                    self.end_headers()
                    self.wfile.write(b)
                    return
                if u.path == "/file":
                    row = node.store.q("SELECT path FROM files WHERE fid=?", (q.get("fid", ""),), one=True)
                    f = Path(row[0]) if row else None
                    if not f or not f.is_file():
                        return self._reply(404, {"error": "not_found"})
                    size = f.stat().st_size
                    start = 0
                    rng = self.headers.get("Range", "")
                    if rng.startswith("bytes="):
                        try:
                            start = int(rng[6:].split("-")[0] or 0)
                        except ValueError:
                            start = 0
                    if 0 < start < size:
                        self.send_response(206)
                        self.send_header("Content-Range", f"bytes {start}-{size - 1}/{size}")
                    else:
                        start = 0
                        self.send_response(200)
                    self.send_header("Content-Length", str(size - start))
                    self.send_header("Content-Type", "application/octet-stream")
                    self.end_headers()
                    with open(f, "rb") as fh:
                        fh.seek(start)
                        while True:
                            b = fh.read(256 * 1024)
                            if not b:
                                break
                            self.wfile.write(b)
                    return
                self._reply(404, {"error": "not_found"})

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(n) if n else b""
                if not node.check_auth(self.headers.get("X-Auth", ""), "POST", self.path, body):
                    return self._reply(401, {"error": "auth"})
                if urlparse(self.path).path == "/msg":
                    try:
                        m = json.loads(body)
                    except Exception:
                        return self._reply(400, {"error": "bad_json"})
                    node.receive(m, self.client_address[0])
                    return self._reply(200, {"ok": True})
                self._reply(404, {"error": "not_found"})

        try:
            self.http = ThreadingHTTPServer(("0.0.0.0", TCP_PORT), Handler)
        except OSError as e:
            raise RuntimeError(f"Порт {TCP_PORT} занят — RafChat уже запущен?") from e
        self.http.daemon_threads = True
        threading.Thread(target=self.http.serve_forever, daemon=True).start()

        self.udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            try:
                self.udp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
            except OSError:
                pass
        self.udp.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        self.udp.bind(("", UDP_PORT))
        threading.Thread(target=self._udp_loop, daemon=True).start()
        threading.Thread(target=self._beacon_loop, daemon=True).start()
        threading.Thread(target=self._outbox_loop, daemon=True).start()
        threading.Thread(target=self._ping_loop, daemon=True).start()
        threading.Thread(target=self._relay_loop, daemon=True).start()

    def stop(self):
        self.running = False
        try:
            self.beacon(bye=True)
        except Exception:
            pass

    # ---------- маяк «я здесь»
    def _beacon_payload(self, ask=False, bye=False) -> bytes:
        d = {"app": "RafChat", "v": 1, "id": self.id, "name": self.cfg["name"], "dept": self.cfg.get("dept", ""),
             "port": TCP_PORT, "plat": "pc", "ask": ask, "bye": bye, "srv": self.cfg.get("server", ""), "srvt": self.cfg.get("srvt", 0),
             "avh": self.cfg.get("avh", "")}
        raw = json.dumps(d, ensure_ascii=False, sort_keys=True)
        return json.dumps({"d": raw, "s": self.sign(raw.encode())}, ensure_ascii=False).encode()

    def broadcast_targets(self):
        out = {("255.255.255.255", UDP_PORT)}
        try:
            import ifaddr
            for ad in ifaddr.get_adapters():
                for ip in ad.ips:
                    if isinstance(ip.ip, str) and not ip.ip.startswith("127."):
                        try:
                            net = ipaddress.ip_network(f"{ip.ip}/{ip.network_prefix}", strict=False)
                            if net.prefixlen < 31:
                                out.add((str(net.broadcast_address), UDP_PORT))
                        except ValueError:
                            pass
        except Exception:
            pass
        for a in (self.cfg.get("extra") or "").replace(";", ",").replace(" ", ",").split(","):
            a = a.strip()
            if a:
                host, _, port = a.partition(":")
                out.add((host, int(port) if port else UDP_PORT))
        for ip, in self.store.q("SELECT DISTINCT ip FROM peers WHERE ip IS NOT NULL"):
            out.add((ip, UDP_PORT))
        return out

    def beacon(self, ask=False, bye=False, to=None):
        data = self._beacon_payload(ask, bye)
        for t in ([to] if to else self.broadcast_targets()):
            try:
                self.udp.sendto(data, t)
            except OSError:
                pass

    def _beacon_loop(self):
        self.beacon(ask=True)
        while self.running:
            time.sleep(4)
            self.beacon()
            self.peers_changed.emit()     # обновить «в сети / не в сети»

    def _udp_loop(self):
        while self.running:
            try:
                data, addr = self.udp.recvfrom(65535)
                env = json.loads(data)
                raw = env["d"]
                if not hmac.compare_digest(env["s"], self.sign(raw.encode())):
                    continue                 # другая организация или чужой
                d = json.loads(raw)
                if d.get("app") != "RafChat" or d["id"] == self.id:
                    continue
                self._seen(d, addr)
            except Exception:
                continue

    def profile(self):
        return {"app": "RafChat", "id": self.id, "name": self.cfg["name"], "dept": self.cfg.get("dept", ""),
                "port": TCP_PORT, "plat": "pc", "srv": self.cfg.get("server", ""), "srvt": self.cfg.get("srvt", 0),
                "avh": self.cfg.get("avh", "")}

    def adopt_server(self, srv, srvt=0):
        """Адрес сервера расходится сам: берём адрес коллеги, если у нас он не задан или у него новее
        (сервер сменили — например, перенесли в Россию). srvt — когда адрес меняли вручную."""
        srv = (srv or "").strip()
        try:
            srvt = float(srvt or 0)
        except (TypeError, ValueError):
            srvt = 0
        mine = (self.cfg.get("server") or "").strip()
        if srv and (not mine or (srv != mine and srvt > float(self.cfg.get("srvt") or 0))):
            self.cfg["server"] = srv
            self.cfg["srvt"] = srvt
            self.cfg["relay_alt"] = None
            self._alt_port, self._alt_tls = None, False
            save_cfg(self.cfg)
            self.peers_changed.emit()

    def set_server(self, addr):
        """Сервер сменили вручную — запоминаем время, чтобы новый адрес разошёлся по всем устройствам."""
        addr = (addr or "").strip()
        if addr != (self.cfg.get("server") or "").strip():
            self.cfg["server"] = addr
            self.cfg["srvt"] = time.time()
            self.cfg["relay_alt"] = None
            self._alt_port, self._alt_tls = None, False
            save_cfg(self.cfg)

    def _check_avatar(self, pid, avh, ip=None, port=None):
        """У коллеги новое фото — скачать (по сети напрямую или с сервера)."""
        if not avh or avh in self._av_loading or time.time() - self._av_fail.get(avh, 0) < 120:
            return
        row = self.store.q("SELECT avh FROM peers WHERE id=?", (pid,), one=True)
        if row and row[0] == avh and peer_photo(pid):
            return
        self._av_loading.add(avh)

        def work():
            data = None
            try:
                if ip:
                    c, r = self._request({"ip": ip, "port": port or 47801}, "GET", "/avatar", timeout=6)
                    data = r.read() if r.status == 200 else None
                    c.close()
                if data is None and self.server_addr():
                    data = self.dec(self._relay_call("GET", "/r/file?" + urlencode({"fid": avh}), timeout=20))
            except Exception:
                data = None
            if data:
                AVATAR_DIR.mkdir(parents=True, exist_ok=True)
                (AVATAR_DIR / f"{pid}.jpg").write_bytes(data)
                self.store.q("UPDATE peers SET avh=? WHERE id=?", (avh, pid))
                self.peers_changed.emit()
            else:
                self._av_fail[avh] = time.time()
            self._av_loading.discard(avh)

        threading.Thread(target=work, daemon=True).start()

    def set_avatar(self, jpeg: bytes | None):
        """Своё фото профиля (None — убрать)."""
        if jpeg:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            MY_AVATAR.write_bytes(jpeg)
            self.cfg["avh"] = hashlib.md5(jpeg).hexdigest()
        else:
            MY_AVATAR.unlink(missing_ok=True)
            self.cfg["avh"] = ""
        self.cfg["avh_up"] = 0
        save_cfg(self.cfg)
        self.beacon()
        self.peers_changed.emit()

    def delete_chat(self, key):
        """Удалить чат: переписку и очередь; личный чат — вместе с участником (вернётся, если появится снова)."""
        self.store.q("DELETE FROM messages WHERE chat=?", (key,))
        if key != ALL:
            self.store.q("DELETE FROM outbox WHERE peer=?", (key,))
            self.store.q("DELETE FROM peers WHERE id=?", (key,))
            self.cfg.setdefault("hidden", {})[key] = time.time()
            save_cfg(self.cfg)
            (AVATAR_DIR / f"{key}.jpg").unlink(missing_ok=True)
        self.peers_changed.emit()

    def _upsert(self, d, ip):
        """Запомнить участника (из маяка, сообщения или ответа на /ping). Возвращает (был ли известен, был ли в сети)."""
        self.adopt_server(d.get("srv"), d.get("srvt"))
        if d.get("avh"):
            self._check_avatar(d["id"], d["avh"], ip, int(d.get("port") or 47801))
        prev = self.store.q("SELECT last_seen, name, dept FROM peers WHERE id=?", (d["id"],), one=True)
        was_online = bool(prev and time.time() - (prev[0] or 0) < ONLINE_SEC)
        self.store.q("INSERT INTO peers(id,name,dept,ip,port,plat,last_seen) VALUES(?,?,?,?,?,?,?) "
                     "ON CONFLICT(id) DO UPDATE SET name=excluded.name, dept=excluded.dept, ip=excluded.ip, "
                     "port=excluded.port, plat=CASE WHEN excluded.plat='' THEN peers.plat ELSE excluded.plat END, "
                     "last_seen=excluded.last_seen",
                     (d["id"], d.get("name") or (prev[1] if prev else "?"),
                      d.get("dept", prev[2] if prev else "") or "", ip, int(d.get("port") or 47801),
                      d.get("plat", ""), time.time()))
        if not prev:
            self._merge_dupes(d["id"])
            self._catch_up(d["id"])
        if not was_online:
            self._wake.set()                        # у нас может быть очередь для него
            self.peers_changed.emit()
        return bool(prev), was_online

    def _merge_dupes(self, pid):
        """Тот же человек с нового устройства (переустановил программу, новый телефон): старую запись
        с тем же именем и отделом, которая не в сети, склеиваем с новой — переписка переезжает, двойника нет."""
        me = self.store.q("SELECT name, dept FROM peers WHERE id=?", (pid,), one=True)
        if not me or not (me[0] or "").strip() or me[0] == "?":
            return
        hidden = self.cfg.setdefault("hidden", {})
        merged = False
        for old, last, rseen in self.store.q(
                "SELECT id, last_seen, relay_seen FROM peers WHERE id<>? AND lower(trim(name))=lower(trim(?)) "
                "AND lower(trim(COALESCE(dept,'')))=lower(trim(?))", (pid, me[0], me[1] or "")):
            if time.time() - (last or 0) < ONLINE_SEC or time.time() - (rseen or 0) < RELAY_ONLINE_SEC:
                continue                                   # оба в сети — значит, это разные люди
            self.store.q("UPDATE messages SET chat=? WHERE chat=?", (pid, old))
            self.store.q("UPDATE OR IGNORE outbox SET peer=? WHERE peer=?", (pid, old))
            self.store.q("DELETE FROM outbox WHERE peer=?", (old,))
            self.store.q("DELETE FROM peers WHERE id=?", (old,))
            (AVATAR_DIR / f"{old}.jpg").unlink(missing_ok=True)
            hidden[old] = time.time()
            merged = True
        if merged:
            save_cfg(self.cfg)
            self.peers_changed.emit()

    def _catch_up(self, pid):
        """Новый участник: дослать ему мои сообщения «Общего чата» за последние сутки."""
        since = now_ms() - 86400 * 1000
        for mid, ts, text, file, status, reply, task in self.store.q(
                "SELECT id,ts,text,file,status,reply,task FROM messages WHERE chat=? AND mine=1 AND ts>?", (ALL, since)):
            m = {"id": mid, "from": self.id, "name": self.cfg["name"], "to": ALL, "ts": ts, "text": text or "",
                 "file": json.loads(file) if file else None, "port": TCP_PORT}
            if reply:
                m["reply"] = json.loads(reply)
            if task:
                m["task"] = json.loads(task)
            self.store.q("INSERT OR IGNORE INTO outbox(peer,msg_id,payload) VALUES(?,?,?)",
                         (pid, mid, json.dumps(m, ensure_ascii=False)))
            if status and "/" in status:
                a, b = status.split("/")
                self.store.q("UPDATE messages SET status=? WHERE id=?", (f"{a}/{int(b) + 1}", mid))

    def _seen(self, d, addr):
        if d.get("bye"):
            self.store.q("UPDATE peers SET last_seen=0 WHERE id=?", (d["id"],))
            self.peers_changed.emit()
            return
        _, was_online = self._upsert(d, addr[0])
        if not was_online or d.get("ask"):
            self.beacon(to=addr)                    # ответить сразу, чтобы нас увидели без ожидания

    def _ping_loop(self):
        """Запасной путь, если маяки (UDP) где-то режутся: спрашиваем известные адреса по TCP «ты тут?»."""
        while self.running:
            time.sleep(6)
            targets = {}
            for p in self.peers():
                if p["ip"] and time.time() - p["lan_seen"] > 8:
                    targets[(p["ip"], p["port"])] = True
            for a in (self.cfg.get("extra") or "").replace(";", ",").replace(" ", ",").split(","):
                host, _, port = a.strip().partition(":")
                if host:
                    targets[(host, int(port) + 1 if port else 47801)] = True
            for ip, port in targets:
                threading.Thread(target=self._ping, args=(ip, port), daemon=True).start()

    def _ping(self, ip, port):
        try:
            c, r = self._request({"ip": ip, "port": port}, "GET", "/ping", timeout=3)
            body = r.read()
            c.close()
            if r.status == 200:
                d = json.loads(body)
                if d.get("id") and d["id"] != self.id:
                    self._upsert(d, ip)
        except (OSError, ValueError, http.client.HTTPException):
            pass

    def peers(self):
        rows = self.store.q("SELECT id,name,dept,ip,port,plat,last_seen,relay_seen FROM peers")
        out = []
        for r in rows:
            lan = bool(r[3]) and time.time() - (r[6] or 0) < ONLINE_SEC
            relay = time.time() - (r[7] or 0) < RELAY_ONLINE_SEC
            out.append(dict(id=r[0], name=r[1], dept=r[2], ip=r[3], port=r[4], plat=r[5], lan=lan, relay=relay,
                            online=lan or relay, last_seen=max(r[6] or 0, r[7] or 0), lan_seen=r[6] or 0,
                            photo=peer_photo(r[0])))
        return out

    def peer(self, pid):
        return next((p for p in self.peers() if p["id"] == pid), None)

    # ---------- HTTP к другому участнику
    def _request(self, peer, method, path, body=b"", headers=None, timeout=10):
        c = http.client.HTTPConnection(peer["ip"], peer["port"], timeout=timeout)
        h = {"X-Auth": self.auth_header(method, path, body)}
        if body:
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        c.request(method, path, body=body or None, headers=h)
        return c, c.getresponse()

    # ---------- отправка
    def send(self, chat: str, text: str = "", file: Path | None = None, reply: dict | None = None,
             task: dict | None = None) -> str:
        mid = uuid.uuid4().hex
        fmeta = None
        if file is not None:
            fid = uuid.uuid4().hex
            self.store.q("INSERT INTO files(fid,path) VALUES(?,?)", (fid, str(file)))
            fmeta = {"fid": fid, "name": file.name, "size": file.stat().st_size}
        m = {"id": mid, "from": self.id, "name": self.cfg["name"], "to": chat, "ts": now_ms(), "text": text,
             "file": fmeta, "port": TCP_PORT}
        if reply:
            m["reply"] = reply
        if task:
            task = dict(task, status=task.get("status") or TASK_NEW, by=self.cfg["name"], at=m["ts"])
            m["task"] = task
        targets = [p["id"] for p in self.peers()] if chat == ALL else [chat]
        status = f"0/{len(targets)}" if chat == ALL else "queued"
        self.store.q("INSERT INTO messages(id,chat,sender,sender_name,ts,text,file,mine,status,local,reply,task) "
                     "VALUES(?,?,?,?,?,?,?,1,?,?,?,?)",
                     (mid, chat, self.id, self.cfg["name"], m["ts"], text, json.dumps(fmeta) if fmeta else None,
                      status, str(file) if file else None,
                      json.dumps(reply, ensure_ascii=False) if reply else None,
                      json.dumps(task, ensure_ascii=False) if task else None))
        payload = json.dumps(m, ensure_ascii=False)
        for t in targets:
            self.store.q("INSERT OR IGNORE INTO outbox(peer,msg_id,payload) VALUES(?,?,?)", (t, mid, payload))
        self.message.emit(mid, True)
        self._wake.set()
        return mid

    def task_update(self, mid: str, status: str):
        """Сменить статус задания (у себя и у всех, кому оно было отправлено)."""
        row = self.store.q("SELECT chat,task FROM messages WHERE id=?", (mid,), one=True)
        if not row or not row[1]:
            return
        chat, task = row[0], json.loads(row[1])
        ts = now_ms()
        task.update(status=status, by=self.cfg["name"], at=ts)
        self.store.q("UPDATE messages SET task=? WHERE id=?", (json.dumps(task, ensure_ascii=False), mid))
        self.message.emit(mid, False)
        # старые версии и iPhone увидят это как обычное сообщение
        upd = {"id": uuid.uuid4().hex, "from": self.id, "name": self.cfg["name"], "to": chat, "ts": ts,
               "type": "task", "task_id": mid, "status": status, "port": TCP_PORT,
               "text": f"📋 «{task.get('title', '')}» — {status}", "file": None}
        targets = [p["id"] for p in self.peers()] if chat == ALL else [chat]
        payload = json.dumps(upd, ensure_ascii=False)
        for t in targets:
            self.store.q("INSERT OR IGNORE INTO outbox(peer,msg_id,payload) VALUES(?,?,?)", (t, upd["id"], payload))
        self._wake.set()

    def _outbox_loop(self):
        while self.running:
            self._wake.wait(3)
            self._wake.clear()
            online = {p["id"]: p for p in self.peers() if p["lan"]}
            relay = bool(self.server_addr())
            for peer_id, mid, payload in self.store.q("SELECT peer,msg_id,payload FROM outbox"):
                p = online.get(peer_id)
                ok = False
                if p:                                     # в одной сети — напрямую
                    try:
                        c, r = self._request(p, "POST", "/msg", payload.encode(), timeout=8)
                        r.read()
                        c.close()
                        ok = r.status == 200
                    except OSError:
                        ok = False
                    if ok:
                        self.store.q("DELETE FROM outbox WHERE peer=? AND msg_id=?", (peer_id, mid))
                        self._delivered(mid)
                        continue
                if relay and self._relay_deliver(peer_id, payload):   # иначе — через сервер
                    self.store.q("DELETE FROM outbox WHERE peer=? AND msg_id=?", (peer_id, mid))
                    self._via_relay(mid)

    def _via_relay(self, mid):
        """Сообщение передано на сервер (✓); «✓✓» — когда получатель подтвердит."""
        row = self.store.q("SELECT chat,status FROM messages WHERE id=?", (mid,), one=True)
        if not row:
            return
        if row[0] == ALL:
            return self._delivered(mid)
        if row[1] != "delivered":
            self.store.q("UPDATE messages SET status='relay' WHERE id=?", (mid,))
            self.message.emit(mid, False)

    # ---------- сервер-ретранслятор (работа через интернет)
    def server_addr(self):
        s = (self.cfg.get("server") or "").strip().replace("http://", "").rstrip("/")
        if not s:
            return None
        host, _, port = s.partition(":")
        return host, getattr(self, "_alt_port", None) or int(port or 47888)

    def _probe_ports(self):
        """Основной порт сервера не отвечает (мобильный интернет режет нестандартные порты) —
        пробуем запасные «веб-порты» и запоминаем первый рабочий."""
        if time.time() - getattr(self, "_probe_at", 0) < 30:
            return
        self._probe_at = time.time()
        s = (self.cfg.get("server") or "").strip().replace("http://", "").rstrip("/")
        host, _, port = s.partition(":")
        main = int(port or 47888)
        # сначала основной, затем шифрованные (TLS) — их мобильные операторы не вырезают, затем веб-порты
        for p, tls in [(main, False)] + [(x, True) for x in RELAY_TLS_PORTS] + [(80, False), (8080, False)]:
            try:
                c = self._relay_conn(host, p, tls, 6)
                c.request("GET", "/")
                ok = b"RafChat Relay" in c.getresponse().read()
                c.close()
            except (OSError, http.client.HTTPException):
                ok = False
            if ok:
                self._alt_port = None if p == main else p
                self._alt_tls = tls
                self.cfg["relay_alt"] = [self._alt_port, tls] if self._alt_port else None
                save_cfg(self.cfg)                         # после перезапуска сразу пойдём через рабочий порт
                return

    @staticmethod
    def _relay_conn(host, port, tls, timeout):
        if tls:
            import ssl
            # сертификат сервера свой (самоподписанный); переписка всё равно зашифрована ключом организации
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return http.client.HTTPSConnection(host, port, timeout=timeout, context=ctx)
        return http.client.HTTPConnection(host, port, timeout=timeout)

    def _relay_call(self, method, path, body=None, raw=None, timeout=15):
        host, port = self.server_addr()
        c = self._relay_conn(host, port, getattr(self, "_alt_tls", False) and bool(getattr(self, "_alt_port", None)),
                             timeout)
        h = {"X-Org": self.org_id, "X-Node": self.id}
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        if data is not None:
            h["Content-Type"] = "application/octet-stream" if raw is not None else "application/json"
        try:
            c.request(method, path, body=data, headers=h)
            r = c.getresponse()
            out = r.read()
        finally:
            c.close()
        if r.status != 200:
            raise OSError(f"сервер ответил {r.status}")
        return out

    def _relay_json(self, method, path, body=None, timeout=15):
        return json.loads(self._relay_call(method, path, body=body, timeout=timeout) or b"{}")

    def _relay_send(self, to, m: dict) -> bool:
        try:
            blob = base64.b64encode(self.enc(json.dumps(m, ensure_ascii=False).encode())).decode()
            self._relay_json("POST", "/r/send", {"to": to, "blob": blob})
            return True
        except (OSError, ValueError, http.client.HTTPException):
            return False

    def _relay_deliver(self, to, payload: str) -> bool:
        m = json.loads(payload)
        f = m.get("file")
        if f and not f.get("relay") and f.get("size", 0) <= RELAY_FILE_MAX:
            if f["fid"] not in self._relay_uploaded:            # файл — на сервер (зашифрованным)
                row = self.store.q("SELECT path FROM files WHERE fid=?", (f["fid"],), one=True)
                if row and Path(row[0]).is_file():
                    try:
                        self._relay_call("PUT", "/r/file?" + urlencode({"fid": f["fid"]}),
                                         raw=self.enc(Path(row[0]).read_bytes()), timeout=300)
                        self._relay_uploaded.add(f["fid"])
                    except (OSError, http.client.HTTPException):
                        return False
            if f["fid"] in self._relay_uploaded:
                f["relay"] = True
        return self._relay_send(to, m)

    def _relay_hello(self):
        avh = self.cfg.get("avh")
        if avh and MY_AVATAR.is_file() and time.time() - float(self.cfg.get("avh_up") or 0) > 86400:
            try:
                self._relay_call("PUT", "/r/file?" + urlencode({"fid": avh}), raw=self.enc(MY_AVATAR.read_bytes()))
                self.cfg["avh_up"] = time.time()
                save_cfg(self.cfg)
            except (OSError, http.client.HTTPException):
                pass
        prof = base64.b64encode(self.enc(json.dumps(self.profile(), ensure_ascii=False).encode())).decode()
        r = self._relay_json("POST", "/r/hello", {"profile": prof})
        now = r.get("now", time.time())
        for p in r.get("peers", []):
            try:
                d = json.loads(self.dec(base64.b64decode(p["profile"])))
            except Exception:
                continue                                    # чужая организация или испорчено
            if d.get("id") != p["id"] or p["id"] == self.id:
                continue
            self._upsert_relay(d, time.time() - (now - p.get("last", 0)))

    def _upsert_relay(self, d, seen):
        self.adopt_server(d.get("srv"), d.get("srvt"))
        prev = self.store.q("SELECT relay_seen, last_seen FROM peers WHERE id=?", (d["id"],), one=True)
        hidden = self.cfg.setdefault("hidden", {})
        if not prev and time.time() - seen > RELAY_ONLINE_SEC:
            # сервер помнит устройства 60 дней: старые установки и удалённые чаты не показываем,
            # пока устройство само не выйдет на связь
            if d["id"] in hidden or time.time() - seen > 3 * 86400:
                return
            # прежняя установка этого же устройства (то же имя и отдел, что у меня) — не показываем
            if (d.get("name") or "").strip().lower() == (self.cfg.get("name") or "").strip().lower() and \
                    (d.get("dept") or "").strip().lower() == (self.cfg.get("dept") or "").strip().lower():
                return
        if d["id"] in hidden:
            hidden.pop(d["id"], None)
            save_cfg(self.cfg)
        was = bool(prev) and (time.time() - max(prev[0] or 0, prev[1] or 0) < RELAY_ONLINE_SEC)
        if d.get("avh"):
            self._check_avatar(d["id"], d["avh"])
        if prev:
            self.store.q("UPDATE peers SET name=COALESCE(?,name), dept=COALESCE(?,dept), relay_seen=MAX(relay_seen,?) "
                         "WHERE id=?", (d.get("name"), d.get("dept"), seen, d["id"]))
        else:
            self.store.q("INSERT INTO peers(id,name,dept,ip,port,plat,last_seen,relay_seen) VALUES(?,?,?,?,?,?,0,?)",
                         (d["id"], d.get("name") or "?", d.get("dept") or "", "", int(d.get("port") or 47801),
                          d.get("plat", ""), seen))
            if time.time() - seen < RELAY_ONLINE_SEC:
                self._merge_dupes(d["id"])
            self._catch_up(d["id"])
        if not was and time.time() - seen < RELAY_ONLINE_SEC:
            self._wake.set()
            self.peers_changed.emit()

    def _relay_loop(self):
        last_hello = 0.0
        while self.running:
            if not self.server_addr():
                self.relay_ok = None
                time.sleep(3)
                continue
            try:
                if time.time() - last_hello > 20:
                    self._relay_hello()
                    last_hello = time.time()
                    if self.relay_ok is not True:
                        self.relay_ok = True
                        self._wake.set()
                        self.peers_changed.emit()
                items = self._relay_json("GET", "/r/poll?wait=25", timeout=40).get("items", [])
                if self.relay_ok is not True:
                    self.relay_ok = True
                    self._wake.set()
                    self.peers_changed.emit()
                acks = []
                for it in items:
                    acks.append(it["qid"])
                    try:
                        m = json.loads(self.dec(base64.b64decode(it["blob"])))
                    except Exception:
                        continue
                    self._relay_item(m)
                if acks:
                    self._relay_json("POST", "/r/ack", {"qids": acks})
            except (OSError, ValueError, http.client.HTTPException):
                if self.relay_ok is not False:
                    self.relay_ok = False
                    self.peers_changed.emit()
                self._probe_ports()
                time.sleep(5)

    def _relay_item(self, m):
        if m.get("type") == "ack":                          # получатель подтвердил — ✓✓
            row = self.store.q("SELECT chat,mine FROM messages WHERE id=?", (m.get("id"),), one=True)
            if row and row[1] and row[0] != ALL:
                self.store.q("UPDATE messages SET status='delivered' WHERE id=?", (m["id"],))
                self.message.emit(m["id"], False)
            return
        if not m.get("id") or not m.get("from") or m["from"] == self.id:
            return
        self.receive(m, None)
        self._relay_send(m["from"], {"type": "ack", "id": m["id"], "from": self.id})

    def _delivered(self, mid):
        row = self.store.q("SELECT chat,status FROM messages WHERE id=?", (mid,), one=True)
        if not row:
            return
        chat, st = row
        if chat == ALL and "/" in (st or ""):
            a, b = st.split("/")
            st = f"{int(a) + 1}/{b}"
        else:
            st = "delivered"
        self.store.q("UPDATE messages SET status=? WHERE id=?", (st, mid))
        self.message.emit(mid, False)

    # ---------- приём
    def receive(self, m, ip):
        if m.get("from") and m["from"] != self.id:
            d = {"id": m["from"], "name": m.get("name"), "port": m.get("port") or 47801, "plat": m.get("plat", "")}
            if ip:
                self._upsert(d, ip)            # пришло сообщение по сети — значит, отправитель в сети
            else:
                self._upsert_relay(d, time.time())
        if m.get("type") == "task":                 # коллега сменил статус задания
            row = self.store.q("SELECT task FROM messages WHERE id=?", (m.get("task_id"),), one=True)
            if row and row[0]:
                task = json.loads(row[0])
                if int(m.get("ts") or 0) >= int(task.get("at") or 0):
                    task.update(status=m.get("status") or task.get("status"), by=m.get("name", "?"), at=m.get("ts"))
                    self.store.q("UPDATE messages SET task=? WHERE id=?",
                                 (json.dumps(task, ensure_ascii=False), m["task_id"]))
                    self.message.emit(m["task_id"], False)
                    self.task_changed.emit(m["task_id"], m.get("name", "?"), task.get("status", ""))
            return
        if self.store.q("SELECT 1 FROM messages WHERE id=?", (m["id"],), one=True):
            return                                  # повтор после обрыва — уже есть
        chat = ALL if m.get("to") == ALL else m["from"]
        f = m.get("file")
        reply, task = m.get("reply"), m.get("task")
        self.store.q("INSERT INTO messages(id,chat,sender,sender_name,ts,text,file,mine,status,local,unread,reply,task) "
                     "VALUES(?,?,?,?,?,?,?,0,?,NULL,1,?,?)",
                     (m["id"], chat, m["from"], m.get("name", "?"), int(m.get("ts") or now_ms()), m.get("text", ""),
                      json.dumps(f) if f else None, "received",
                      json.dumps(reply, ensure_ascii=False) if isinstance(reply, dict) else None,
                      json.dumps(task, ensure_ascii=False) if isinstance(task, dict) else None))
        self.message.emit(m["id"], True)
        if f and f.get("size", 0) <= AUTO_DOWNLOAD and self.cfg.get("auto_dl", True):
            self.download(m["id"])

    def download(self, mid):
        if mid in self._downloading:
            return
        self._downloading.add(mid)
        threading.Thread(target=self._download, args=(mid,), daemon=True).start()

    def _download(self, mid):
        try:
            row = self.store.q("SELECT sender,file,local FROM messages WHERE id=?", (mid,), one=True)
            if not row or not row[1]:
                return
            sender, f = row[0], json.loads(row[1])
            if row[2] and Path(row[2]).exists():
                return
            dest_dir = Path(self.cfg.get("downloads") or default_downloads())
            dest_dir.mkdir(parents=True, exist_ok=True)
            dest = C.unique_path(dest_dir, C.clean_name(f["name"]))
            part = dest_dir / f".{mid}.part"
            for attempt in range(40):           # ждём отправителя до ~10 минут, продолжая с места обрыва
                p = self.peer(sender)
                if not (p and p["lan"]) and f.get("relay") and self.server_addr():
                    try:                                # отправитель не в нашей сети — берём копию с сервера
                        data = self.dec(self._relay_call("GET", "/r/file?" + urlencode({"fid": f["fid"]}), timeout=300))
                        dest.write_bytes(data)
                        self.store.q("UPDATE messages SET local=? WHERE id=?", (str(dest), mid))
                        self.file_progress.emit(mid, f["size"], f["size"])
                        self.message.emit(mid, False)
                        return
                    except Exception:
                        pass
                if p and p["lan"]:
                    have = part.stat().st_size if part.exists() else 0
                    try:
                        path = "/file?" + urlencode({"fid": f["fid"]})
                        c, r = self._request(p, "GET", path, headers={"Range": f"bytes={have}-"} if have else None,
                                             timeout=20)
                        if r.status == 404:
                            self.store.q("UPDATE messages SET status='gone' WHERE id=?", (mid,))
                            self.message.emit(mid, False)
                            return
                        if r.status == 200:
                            have = 0
                        with open(part, "ab" if have else "wb") as fh:
                            got = have
                            last = 0.0
                            while True:
                                b = r.read(256 * 1024)
                                if not b:
                                    break
                                fh.write(b)
                                got += len(b)
                                if time.time() - last > 0.15:
                                    last = time.time()
                                    self.file_progress.emit(mid, got, f["size"])
                        c.close()
                        if part.stat().st_size >= f["size"]:
                            part.replace(dest)
                            self.store.q("UPDATE messages SET local=? WHERE id=?", (str(dest), mid))
                            self.file_progress.emit(mid, f["size"], f["size"])
                            self.message.emit(mid, False)
                            return
                    except (OSError, http.client.HTTPException):
                        pass
                time.sleep(15)
        finally:
            self._downloading.discard(mid)

    # ---------- чтение для интерфейса
    def msg(self, mid):
        r = self.store.q("SELECT id,chat,sender,sender_name,ts,text,file,mine,status,local,reply,task FROM messages "
                         "WHERE id=?", (mid,), one=True)
        return self._row(r) if r else None

    @staticmethod
    def _row(r):
        return dict(id=r[0], chat=r[1], sender=r[2], sender_name=r[3], ts=r[4], text=r[5] or "",
                    file=json.loads(r[6]) if r[6] else None, mine=bool(r[7]), status=r[8], local=r[9],
                    reply=json.loads(r[10]) if r[10] else None, task=json.loads(r[11]) if r[11] else None)

    def search(self, text: str, limit=100):
        """Поиск по всей переписке: текст, имена файлов, задания."""
        pat = "%" + text.lower().replace("%", "").replace("_", "") + "%"
        rows = self.store.q("SELECT id,chat,sender,sender_name,ts,text,file,mine,status,local,reply,task FROM messages "
                            "WHERE lowr(text) LIKE ? OR lowr(file) LIKE ? OR lowr(task) LIKE ? OR lowr(sender_name) LIKE ? "
                            "ORDER BY ts DESC LIMIT ?", (pat, pat, pat, pat, limit))
        return [self._row(r) for r in rows]

    def tasks(self, limit=200):
        rows = self.store.q("SELECT id,chat,sender,sender_name,ts,text,file,mine,status,local,reply,task FROM messages "
                            "WHERE task IS NOT NULL ORDER BY ts DESC LIMIT ?", (limit,))
        return [self._row(r) for r in rows]

    def history(self, chat, limit=500):
        rows = self.store.q("SELECT id,chat,sender,sender_name,ts,text,file,mine,status,local,reply,task FROM messages "
                            "WHERE chat=? ORDER BY ts DESC LIMIT ?", (chat, limit))
        return [self._row(r) for r in reversed(rows)]

    def last_and_unread(self, chat):
        last = self.store.q("SELECT id,chat,sender,sender_name,ts,text,file,mine,status,local,reply,task FROM messages "
                            "WHERE chat=? ORDER BY ts DESC LIMIT 1", (chat,), one=True)
        unread = self.store.q("SELECT COUNT(*) FROM messages WHERE chat=? AND unread=1", (chat,), one=True)[0]
        return (self._row(last) if last else None), unread

    def mark_read(self, chat):
        self.store.q("UPDATE messages SET unread=0 WHERE chat=? AND unread=1", (chat,))

    def queued_count(self):
        return self.store.q("SELECT COUNT(*) FROM outbox", one=True)[0]


# ======================================================================= настройки

def defaults() -> dict:
    """Настройки, встроенные в установщик (адрес сервера организации)."""
    base = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent
    try:
        return json.loads((base / "defaults.json").read_text("utf-8"))
    except Exception:
        return {}


def load_cfg() -> dict:
    f = DATA_DIR / "config.json"
    try:
        return json.loads(f.read_text("utf-8"))
    except Exception:
        return {}


def save_cfg(cfg: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), "utf-8")


def chat_qss() -> str:
    return C.qss() + f"""
    QFrame#sidebar {{ background: {P['surface']}; border-right: 1px solid {P['line']}; }}
    QFrame#chathead {{ background: {P['surface']}; border-bottom: 1px solid {P['line']}; }}
    QFrame#composer {{ background: {P['surface']}; border-top: 1px solid {P['line']}; }}
    QWidget#msgs {{ background: transparent; }}
    QFrame#bubble_jumbo {{ background: transparent; }}
    QLabel#jumbo {{ font-size: 46px; }}
    QFrame#bubble_me {{ background: {P['accent']}; border-radius: 18px; }}
    QFrame#bubble_them {{ background: {P['surface']}; border-radius: 18px; }}
    QLabel#me_text {{ color: #FFFFFF; font-size: 15px; }}
    QLabel#them_text {{ color: {P['text']}; font-size: 15px; }}
    QLabel#me_meta {{ color: rgba(255,255,255,0.75); font-size: 12px; }}
    QLabel#them_meta {{ color: {P['muted']}; font-size: 12px; }}
    QLabel#day {{ color: {P['muted']}; font-size: 12px; font-weight: 600; background: {P['sub']};
                  border-radius: 10px; padding: 3px 10px; }}
    QPlainTextEdit#input {{ background: {P['sub']}; border: 0; border-radius: 18px; padding: 8px 12px;
                            font-size: 15px; }}
    QPushButton#round {{ background: {P['accent']}; border-radius: 19px; min-width: 38px; max-width: 38px;
                         min-height: 38px; max-height: 38px; padding: 0; }}
    QPushButton#round:disabled {{ background: {P['line']}; }}
    QListWidget#chats::item {{ border-radius: 12px; margin: 1px 6px; }}
    QListWidget#chats::item:selected {{ background: {P['wash']}; }}
    QListWidget#chats::item:hover:!selected {{ background: {P['hover']}; }}
    """


# ======================================================================= окно

ROLE = Qt.UserRole + 1


EMOJI = {
    "😀": "😀😃😄😁😆😅🤣😂🙂😉😊😇🥰😍🤩😘😋😜🤪😎🤓🧐🤔🤨😐😑😶🙄😏😴🤤🥱😬🤐😷🤒🤕🤢🥵🥶🤯🥳🥺😢😭😤😠😡🤬"
          "😱😨😰😓🤗🤭🫡🤫😈💀🤡👻👽🤖💩",
    "👍": "👍👎👌🤌✌️🤞🤟🤘👊✊🤛🤜👏🙌🫶👐🙏🤝💪👋🤙👆👇👉👈☝️✋🖐️🫵",
    "🔧": "🔧🔩⚙️🛠️⛏️🔨🪛🪚🧰📐📏🧲🔥⚡🏭🏗️🚧⚠️🦺🪖🧪🔬💡🔋🖥️💻🖨️⌨️🖱️📦🚚⏱️⏳📅📋📌📎✂️🗜️🛞",
    "❤️": "❤️🧡💛💚💙💜🖤🤍💯✅❌❗❓💬🎉🎂🍕☕🍺🍻🎁🏆⭐🌟☀️🌧️❄️🌈🚀💰💵📞📷🎵😺🐶🐱🐻🦊",
}


def split_emoji(s: str) -> list:
    """Разбить строку смайликов на отдельные (с вариантами ️ и склейками ‍)."""
    out, cur = [], ""
    for ch in s:
        if cur and ch not in "\ufe0f\u200d" and not cur.endswith("\u200d") and not (0x1F3FB <= ord(ch) <= 0x1F3FF):
            out.append(cur)
            cur = ""
        cur += ch
    if cur:
        out.append(cur)
    return out


def is_jumbo(text: str) -> bool:
    """Сообщение только из 1–3 смайликов — показываем крупно, как в WhatsApp."""
    t = text.strip()
    if not t or len(t) > 24:
        return False
    if any(ch.isalnum() or ch in ".,!?:;()-_\"'" for ch in t if ord(ch) < 0x2000):
        return False
    return all(ord(ch) >= 0x2190 or ch in " \ufe0f\u200d" for ch in t) and len(split_emoji(t.replace(" ", ""))) <= 3


class EmojiPanel(QFrame):
    """Панель смайликов (раздел — вкладка сверху)."""
    picked = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent, Qt.Popup)
        self.setObjectName("card")
        self.setFixedSize(400, 320)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(8, 8, 8, 8)
        tabs = QHBoxLayout()
        self.grid_host = QScrollArea()
        self.grid_host.setWidgetResizable(True)
        self.grid_host.setFrameShape(QFrame.NoFrame)
        self.grid_host.setStyleSheet("QScrollArea, QScrollArea > QWidget > QWidget { background: transparent; }")
        for k in EMOJI:
            b = button(k, "icon", fn=lambda _=False, k=k: self.show_cat(k))
            b.setStyleSheet("font-size:20px")
            tabs.addWidget(b)
        tabs.addStretch(1)
        lay.addLayout(tabs)
        lay.addWidget(self.grid_host, 1)
        self.show_cat("😀")

    def show_cat(self, k):
        from PySide6.QtWidgets import QGridLayout
        w = QWidget()
        g = QGridLayout(w)
        g.setSpacing(2)
        g.setContentsMargins(0, 0, 0, 0)
        f = QFont("Segoe UI Emoji" if IS_WIN else "Noto Color Emoji")
        f.setPixelSize(24)
        for i, e in enumerate(split_emoji(EMOJI[k])):
            b = button(e, "icon", fn=lambda _=False, e=e: self.picked.emit(e))
            b.setFont(f)
            b.setStyleSheet("font-size:26px; padding:0; border-radius:8px")
            b.setFixedSize(42, 42)
            g.addWidget(b, i // 8, i % 8)
        self.grid_host.setWidget(w)


class MsgsArea(QWidget):
    """Фон переписки — узор из чертёжных мотивов (шестерни, гайки, штангенциркуль), как обои в WhatsApp."""

    def __init__(self):
        super().__init__()
        self.setObjectName("msgs")
        self.tile = None

    def _tile(self):
        if self.tile is None:
            from PySide6.QtCore import QByteArray
            from PySide6.QtSvg import QSvgRenderer
            base = Path(getattr(sys, "_MEIPASS", "")) if getattr(sys, "frozen", False) \
                else Path(__file__).resolve().parent.parent / "assets"
            f = base / "chat_pattern.svg"
            pm = QPixmap(480 * 2, 480 * 2)
            pm.setDevicePixelRatio(2)
            pm.fill(Qt.transparent)
            if f.is_file():
                p = QPainter(pm)
                p.setOpacity(0.42)
                QSvgRenderer(QByteArray(f.read_bytes())).render(p, QRectF(0, 0, 480, 480))
                p.end()
            self.tile = pm
        return self.tile

    def paintEvent(self, ev):
        p = QPainter(self)
        p.fillRect(self.rect(), QColor("#ECEEF2"))
        p.drawTiledPixmap(self.rect(), self._tile())
        p.end()


class ChatRow(QWidget):
    def __init__(self, title, preview, when, unread, online, pix):
        super().__init__()
        lay = QHBoxLayout(self)
        lay.setContentsMargins(10, 8, 10, 8)
        lay.setSpacing(10)
        av = QLabel()
        av.setPixmap(pix)
        av.setFixedSize(44, 44)
        lay.addWidget(av)
        col = QVBoxLayout()
        col.setSpacing(1)
        top = QHBoxLayout()
        t = QLabel()
        t.setStyleSheet("font-weight:650; font-size:15px")
        f = t.font()
        f.setPixelSize(15)
        f.setWeight(QFont.DemiBold)
        from PySide6.QtGui import QFontMetrics
        t.setText(QFontMetrics(f).elidedText(title, Qt.ElideRight, 170 if when else 210))
        t.setToolTip(title)
        top.addWidget(t, 1)
        w = QLabel(when)
        w.setStyleSheet(f"color:{P['muted']}; font-size:12px")
        top.addWidget(w)
        col.addLayout(top)
        bot = QHBoxLayout()
        pv = QLabel()
        pv.setStyleSheet(f"color:{P['muted']}; font-size:13px")
        pv.setText(QLabel().fontMetrics().elidedText(preview, Qt.ElideRight, 170))
        bot.addWidget(pv, 1)
        if unread:
            b = QLabel(str(unread))
            b.setAlignment(Qt.AlignCenter)
            b.setMinimumWidth(22)
            b.setStyleSheet(f"background:{P['accent']}; color:white; border-radius:11px; font-size:12px;"
                            f"font-weight:700; padding:2px 6px")
            bot.addWidget(b)
        col.addLayout(bot)
        lay.addLayout(col, 1)
        self.online = online


IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp"}


def snippet(m: dict, n=70) -> str:
    """Коротко о сообщении — для цитаты в ответе и результатов поиска."""
    if m.get("task"):
        t = "📋 " + m["task"].get("title", "задание")
    elif m.get("file") and not m.get("text"):
        t = "📎 " + m["file"]["name"]
    else:
        t = (m.get("text") or "").replace("\n", " ")
    return t if len(t) <= n else t[:n - 1] + "…"


def task_fallback(t: dict) -> str:
    """Текст задания для старых версий RafChat и iPhone (они не умеют показывать карточку)."""
    parts = [f"📋 Задание: {t['title']}"]
    for k, lbl in (("drawing", "Чертёж/УП"), ("material", "Материал"), ("qty", "Кол-во"), ("due", "Срок"),
                   ("who", "Исполнитель"), ("note", "")):
        if t.get(k):
            parts.append(f"{lbl}: {t[k]}" if lbl else str(t[k]))
    return "\n".join(parts)


def due_info(due: str):
    """«10.11.2026» → (текст, просрочено ли)."""
    try:
        d = datetime.strptime(due, "%d.%m.%Y").date()
    except (ValueError, TypeError):
        return due, False
    left = (d - datetime.now().date()).days
    if left < 0:
        return f"до {d:%d.%m} — просрочено на {-left} дн.", True
    if left == 0:
        return f"до {d:%d.%m} — сегодня", True
    return f"до {d:%d.%m} (осталось {left} дн.)", False


def image_thumb(path: str, side: int) -> QPixmap | None:
    """Миниатюра фото (длинная сторона ≤ side) со скруглёнными углами; поворот по EXIF учитывается."""
    from PySide6.QtGui import QImageReader, QPainterPath
    r = QImageReader(path)
    r.setAutoTransform(True)
    sz = r.size()
    if sz.isValid() and sz.width() > 0 and sz.height() > 0:
        k = min(1.0, side * 2 / max(sz.width(), sz.height()))
        r.setScaledSize(QSize(max(1, int(sz.width() * k)), max(1, int(sz.height() * k))))
    img = r.read()
    if img.isNull():
        return None
    img = img.scaled(side * 2, side * 2, Qt.KeepAspectRatio, Qt.SmoothTransformation)
    pm = QPixmap(img.size())
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    path_ = QPainterPath()
    path_.addRoundedRect(QRectF(0, 0, img.width(), img.height()), 20, 20)
    p.setClipPath(path_)
    p.drawImage(0, 0, img)
    p.end()
    pm.setDevicePixelRatio(2)
    return pm


class Bubble(QFrame):
    def __init__(self, win: "ChatWindow", m: dict, show_name: bool):
        super().__init__()
        self.win = win
        self.m = m
        me = m["mine"]
        jumbo = bool(m["text"]) and not m["file"] and is_jumbo(m["text"])
        self.setObjectName("bubble_jumbo" if jumbo else ("bubble_me" if me else "bubble_them"))
        self.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Preferred)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(14, 8, 14, 7)
        lay.setSpacing(3)
        if show_name and not me:
            n = QLabel(m["sender_name"])
            n.setStyleSheet(f"color:{avatar_color(m['sender'])}; font-weight:700; font-size:13px")
            lay.addWidget(n)
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._menu)
        if m.get("reply"):                                 # цитата сообщения, на которое ответили
            rp = m["reply"]
            q = QFrame()
            q.setCursor(Qt.PointingHandCursor)
            q.setStyleSheet(f"QFrame {{ background: {'rgba(255,255,255,0.18)' if me else '#EEF1F5'};"
                            f" border-left: 3px solid {'#FFFFFF' if me else P['accent']}; border-radius: 6px; }}"
                            "QLabel { background: transparent; border: 0; }")
            ql = QVBoxLayout(q)
            ql.setContentsMargins(8, 4, 8, 4)
            ql.setSpacing(0)
            qn = QLabel(rp.get("name", ""))
            qn.setStyleSheet(f"font-weight:700; font-size:12px; color:{'#FFFFFF' if me else P['accent']}")
            qt = QLabel(rp.get("text", ""))
            qt.setStyleSheet(f"font-size:13px; color:{'rgba(255,255,255,0.85)' if me else P['muted']}")
            qt.setMaximumWidth(400)
            ql.addWidget(qn)
            ql.addWidget(qt)
            q.mousePressEvent = lambda e, rid=rp.get("id"): self.win.jump_to(self.m["chat"], rid)
            lay.addWidget(q)
        self.task_box = None
        if m.get("task"):
            self._build_task(lay)
        f = m["file"]
        self.thumb = None
        self._photo = False
        if f and Path(f["name"]).suffix.lower() in IMAGE_EXT:
            # фото показываем прямо в переписке (как в WhatsApp); щелчок — открыть крупно
            self.thumb = QLabel()
            self.thumb.setCursor(Qt.PointingHandCursor)
            self.thumb.setToolTip("Открыть фото")
            self.thumb.hide()
            self.thumb.mousePressEvent = lambda e: self._file_action()
            lay.addWidget(self.thumb)
        if f:
            self.frow = QWidget()
            self.frow.setStyleSheet("background: transparent")
            row = QHBoxLayout(self.frow)
            row.setContentsMargins(0, 0, 0, 0)
            row.setSpacing(10)
            ic = QLabel()
            ic.setPixmap(type_icon({"name": f["name"]}, 34))
            row.addWidget(ic)
            col = QVBoxLayout()
            col.setSpacing(1)
            nm = QLabel(f["name"])
            nm.setWordWrap(True)
            nm.setMaximumWidth(300)
            nm.setStyleSheet(f"font-weight:650; color:{'#FFFFFF' if me else P['text']}")
            col.addWidget(nm)
            self.finfo = QLabel()
            self.finfo.setObjectName("me_meta" if me else "them_meta")
            col.addWidget(self.finfo)
            row.addLayout(col, 1)
            lay.addWidget(self.frow)
            self.bar = QProgressBar()
            self.bar.setFixedHeight(5)
            self.bar.setTextVisible(False)
            self.bar.hide()
            lay.addWidget(self.bar)
            self.fbtn = button("", "link")
            self.fbtn.setStyleSheet(f"color:{'#FFFFFF' if me else P['accent']}; text-align:left; padding:0")
            self.fbtn.clicked.connect(self._file_action)
            lay.addWidget(self.fbtn)
        if m.get("task"):
            pass                                            # у задания вместо текста — карточка
        elif m["text"] and jumbo:
            t = QLabel(m["text"].strip())
            t.setObjectName("jumbo")
            f = QFont("Segoe UI Emoji" if IS_WIN else "Noto Color Emoji")
            f.setPixelSize(46)
            t.setFont(f)
            lay.addWidget(t)
        elif m["text"]:
            t = QLabel(m["text"])
            t.setObjectName("me_text" if me else "them_text")
            t.setWordWrap(True)
            t.setTextInteractionFlags(Qt.TextSelectableByMouse | Qt.LinksAccessibleByMouse)
            t.setOpenExternalLinks(True)
            longest = max((t.fontMetrics().horizontalAdvance(x) for x in m["text"].split("\n")), default=0)
            t.setMinimumWidth(min(longest + 4, 420))
            t.setMaximumWidth(460)
            lay.addWidget(t)
        self.meta = QLabel()
        self.meta.setObjectName("them_meta" if jumbo else ("me_meta" if me else "them_meta"))
        self.meta.setAlignment(Qt.AlignRight)
        lay.addWidget(self.meta)
        self.refresh(m)

    def refresh(self, m):
        self.m = m
        if m.get("task") and getattr(self, "task_title", None) is not None:
            self._fill_task()
        t = datetime.fromtimestamp(m["ts"] / 1000).strftime("%H:%M")
        st = ""
        if m["mine"]:
            s = m["status"] or ""
            if s == "queued":
                st = "  🕓 ждёт получателя"
            elif s == "relay":
                st = "  ✓ на сервере"
            elif s == "delivered":
                st = "  ✓✓"
            elif "/" in s:
                a, b = s.split("/")
                st = "  ✓✓" if a == b and b != "0" else f"  ✓ {a} из {b}"
        self.meta.setText(t + st)
        f = m["file"]
        if f:
            local = Path(m["local"]) if m["local"] else None
            have = local is not None and local.exists()
            self.finfo.setText(human(f["size"]))
            if self.thumb is not None and have and not self._photo:
                pm = image_thumb(str(local), 300)
                if pm is not None:
                    self.thumb.setPixmap(pm)
                    self.thumb.show()
                    self.frow.hide()                       # у фото — только картинка и время
                    self._photo = True
            if self._photo:
                self.fbtn.hide()
            elif m["mine"]:
                self.fbtn.setText("Показать в папке" if have else "")
                self.fbtn.setVisible(have)
            elif have:
                self.fbtn.setText("Открыть файл")
                self.bar.hide()
            elif m["status"] == "gone":
                self.fbtn.setText("Файл больше недоступен у отправителя")
                self.fbtn.setEnabled(False)
            else:
                self.fbtn.setText("Скачать")

    def _build_task(self, lay):
        me = self.m["mine"]
        fg = "#FFFFFF" if me else P["text"]
        mu = "rgba(255,255,255,0.8)" if me else P["muted"]
        self.setMinimumWidth(300)
        hd = QLabel("📋 ЗАДАНИЕ")
        hd.setStyleSheet(f"font-size:12px; font-weight:700; color:{mu}; letter-spacing:1px")
        lay.addWidget(hd)
        self.task_title = QLabel()
        self.task_title.setWordWrap(True)
        self.task_title.setStyleSheet(f"font-size:17px; font-weight:700; color:{fg}")
        lay.addWidget(self.task_title)
        self.task_info = QLabel()
        self.task_info.setWordWrap(True)
        self.task_info.setTextFormat(Qt.RichText)
        self.task_info.setStyleSheet(f"font-size:14px; color:{fg}")
        lay.addWidget(self.task_info)
        st = QHBoxLayout()
        st.setSpacing(8)
        self.task_chip = QLabel()
        self.task_chip.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Fixed)
        st.addWidget(self.task_chip)
        self.task_by = QLabel()
        self.task_by.setStyleSheet(f"font-size:12px; color:{mu}")
        st.addWidget(self.task_by, 1)
        lay.addLayout(st)
        self.task_btns = QHBoxLayout()
        self.task_btns.setSpacing(6)
        lay.addLayout(self.task_btns)
        self._fill_task()

    def _fill_task(self):
        t = self.m["task"]
        me = self.m["mine"]
        self.task_title.setText(t.get("title", ""))
        rows = []
        if t.get("drawing"):
            rows.append(f"Чертёж / УП: <b>{t['drawing']}</b>")
        mq = " · ".join(x for x in (t.get("material"), f"{t['qty']} шт" if t.get("qty") else "") if x)
        if mq:
            rows.append(f"Материал: <b>{mq}</b>")
        if t.get("due"):
            txt, bad = due_info(t["due"])
            late = bad and t.get("status") not in (TASK_DONE, TASK_OK)
            rows.append(f"Срок: <b style='color:#FF3B30'>⚠ {txt}</b>" if late and not me
                        else f"Срок: <b>{'⚠ ' if late else ''}{txt}</b>")
        if t.get("who"):
            rows.append(f"Исполнитель: <b>{t['who']}</b>")
        if t.get("note"):
            rows.append(t["note"].replace("\n", "<br>"))
        self.task_info.setText("<br>".join(rows))
        status = t.get("status") or TASK_NEW
        col = TASK_COLORS.get(status, P["muted"])
        self.task_chip.setText(f" {status} ")
        self.task_chip.setStyleSheet(f"background:{'#FFFFFF' if me else col}; color:{col if me else '#FFFFFF'};"
                                     "border-radius:9px; padding:2px 8px; font-size:13px; font-weight:700")
        when = datetime.fromtimestamp((t.get("at") or self.m["ts"]) / 1000).strftime("%d.%m %H:%M")
        self.task_by.setText(f"{t.get('by', '')} · {when}")
        while self.task_btns.count():
            w = self.task_btns.takeAt(0).widget()
            if w:
                w.hide()                      # сразу убрать с экрана (deleteLater срабатывает не мгновенно)
                w.setParent(None)
                w.deleteLater()
        for text, nxt in TASK_NEXT.get(status, []):
            b = button(text, "tinted", fn=lambda _=False, n=nxt: self.win.node.task_update(self.m["id"], n))
            b.setStyleSheet("min-height:32px; font-size:14px; padding:2px 12px")
            self.task_btns.addWidget(b)
        fb = button("📎 Файл", "tinted", tip="Прикрепить к заданию файл или фото (модель, УП, чертёж)",
                    fn=lambda: self.win.attach_to_task(self.m))
        fb.setStyleSheet("min-height:32px; font-size:14px; padding:2px 10px")
        self.task_btns.addWidget(fb)
        self.task_btns.addStretch(1)

    def _menu(self, pos):
        mn = QMenu(self)
        a_reply = mn.addAction("Ответить")
        a_copy = mn.addAction("Копировать текст") if self.m["text"] and not self.m.get("task") else None
        act = mn.exec(self.mapToGlobal(pos))
        if act is a_reply:
            self.win.start_reply(self.m)
        elif a_copy is not None and act is a_copy:
            QApplication.clipboard().setText(self.m["text"])

    def flash(self):
        """Подсветить облачко (переход из поиска или по цитате)."""
        eff = self.graphicsEffect()
        from PySide6.QtWidgets import QGraphicsColorizeEffect
        e = QGraphicsColorizeEffect(self)
        e.setColor(QColor("#FFCC00"))
        e.setStrength(0.55)
        self.setGraphicsEffect(e)
        QTimer.singleShot(1400, lambda: self.setGraphicsEffect(eff))

    def progress(self, got, total):
        self.bar.show()
        self.bar.setRange(0, 1000)
        self.bar.setValue(int(got * 1000 / max(total, 1)))
        self.finfo.setText(f"{human(got)} из {human(total)}")
        self.fbtn.setText("Скачивается…")

    def _file_action(self):
        local = Path(self.m["local"]) if self.m["local"] else None
        if local and local.exists():
            if self.thumb is not None:
                open_local(local)
            else:
                (show_in_folder if self.m["mine"] else open_local)(local)
        elif not self.m["mine"]:
            self.win.node.download(self.m["id"])
            self.fbtn.setText("Жду отправителя…")


RELAY_TLS_PORTS = (2053, 2083, 2087, 9443)   # шифрованные порты сервера (см. server/install.sh)
TASK_NEW, TASK_WORK, TASK_DONE, TASK_OK, TASK_REWORK = "Новое", "В работе", "Готово", "Принято ОТК", "Доработка"
TASK_COLORS = {TASK_NEW: "#8E8E93", TASK_WORK: "#FF9500", TASK_DONE: "#007AFF", TASK_OK: "#34C759",
               TASK_REWORK: "#FF3B30"}
# какие кнопки показывать при каждом статусе
TASK_NEXT = {TASK_NEW: [("Взять в работу", TASK_WORK)], TASK_WORK: [("Готово", TASK_DONE)],
             TASK_DONE: [("Принято ОТК", TASK_OK), ("Доработка", TASK_REWORK)],
             TASK_REWORK: [("Взять в работу", TASK_WORK)], TASK_OK: []}
UPDATE_API = "https://api.github.com/repos/sharapovrafail-bot/modelview/releases/tags/rafchat-latest"


def _ver(v: str) -> tuple:
    try:
        return tuple(int(x) for x in v.split("."))
    except ValueError:
        return (0,)


class Updater(QObject):
    """Автообновление: раз в 6 часов смотрит последнюю сборку на GitHub; есть новее — предлагает обновить."""
    found = Signal(str, str)                 # версия, ссылка на установщик
    progress = Signal(int, int)
    done = Signal(str)                       # путь к скачанному установщику или "" при ошибке

    def __init__(self):
        super().__init__()
        self.ver = ""
        self.url = ""
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        time.sleep(20)
        while True:
            self.check()
            time.sleep(6 * 3600)

    def check(self):
        import re
        import urllib.request
        try:
            req = urllib.request.Request(UPDATE_API, headers={"User-Agent": f"RafChat/{APP_VER}",
                                                              "Accept": "application/vnd.github+json"})
            with urllib.request.urlopen(req, timeout=20) as r:
                rel = json.loads(r.read())
        except Exception:
            return
        for a in rel.get("assets", []):
            mt = re.fullmatch(r"RafChat-Setup-(\d+\.\d+\.\d+)\.exe", a.get("name", ""))
            if mt and _ver(mt.group(1)) > _ver(APP_VER):
                self.ver, self.url = mt.group(1), a["browser_download_url"]
                self.found.emit(self.ver, self.url)

    def download(self):
        threading.Thread(target=self._download, daemon=True).start()

    def _download(self):
        import tempfile
        import urllib.request
        out = Path(tempfile.gettempdir()) / f"RafChat-Setup-{self.ver}.exe"
        try:
            req = urllib.request.Request(self.url, headers={"User-Agent": f"RafChat/{APP_VER}"})
            with urllib.request.urlopen(req, timeout=60) as r, open(out, "wb") as fh:
                total = int(r.headers.get("Content-Length") or 0)
                got = 0
                while True:
                    b = r.read(256 * 1024)
                    if not b:
                        break
                    fh.write(b)
                    got += len(b)
                    self.progress.emit(got, total)
            self.done.emit(str(out))
        except Exception:
            self.done.emit("")


class ChatWindow(QMainWindow):
    def __init__(self, node: Node, cfg: dict):
        super().__init__()
        self.node = node
        self.cfg = cfg
        self.chat = ALL
        self.bubbles: dict = {}
        self.setWindowTitle(f"RafChat {APP_VER}")
        self.setWindowIcon(QIcon(C.app_icon_pixmap()))
        self.resize(980, 680)
        self.setMinimumSize(720, 480)
        self.setAcceptDrops(True)

        root = QWidget()
        root.setObjectName("root")
        self.setCentralWidget(root)
        h = QHBoxLayout(root)
        h.setContentsMargins(0, 0, 0, 0)
        h.setSpacing(0)

        # ---- слева: чаты
        side = QFrame()
        side.setObjectName("sidebar")
        side.setFixedWidth(310)
        sl = QVBoxLayout(side)
        sl.setContentsMargins(0, 14, 0, 8)
        sl.setSpacing(6)
        top = QHBoxLayout()
        top.setContentsMargins(16, 0, 8, 0)
        t = label("Чаты", "h1")
        top.addWidget(t, 1)
        gb = button("", "icon", icon="gear", tip="Настройки", color=P["muted"])
        gm = QMenu(gb)
        gm.addAction("Профиль и сеть…", self.settings)
        gm.addAction("Установить сервер на VPS…", self.setup_server)
        gm.addAction("Фото профиля…", self.choose_photo)
        gm.addAction("Папка с файлами", lambda: open_local(self._downloads()))
        gm.addSeparator()
        gm.addAction(f"О программе RafChat {APP_VER}", self.about)
        gm.addAction(f"Написать автору: {APP_EMAIL}",
                     lambda: QDesktopServices.openUrl(QUrl(f"mailto:{APP_EMAIL}?subject=RafChat {APP_VER}")))
        gb.clicked.connect(lambda: gm.exec(gb.mapToGlobal(QPoint(0, gb.height()))))
        top.addWidget(gb)
        sl.addLayout(top)
        self.me_lbl = label("", "small")
        self.me_lbl.setContentsMargins(16, 0, 0, 4)
        sl.addWidget(self.me_lbl)
        srow = QHBoxLayout()
        srow.setContentsMargins(12, 0, 8, 2)
        self.search = QLineEdit()
        self.search.setObjectName("search")
        self.search.setPlaceholderText("🔍  Поиск по переписке")
        self.search.setClearButtonEnabled(True)
        self.search.textChanged.connect(self._do_search)
        srow.addWidget(self.search, 1)
        self.tasks_btn = button("📋", "icon", tip="Все задания", fn=self.show_tasks)
        self.tasks_btn.setStyleSheet("font-size:20px")
        srow.addWidget(self.tasks_btn)
        sl.addLayout(srow)
        self.results = QListWidget()
        self.results.setObjectName("chats")
        self.results.setWordWrap(True)
        self.results.itemClicked.connect(self._open_result)
        self.results.hide()
        sl.addWidget(self.results, 1)
        self.chats = QListWidget()
        self.chats.setObjectName("chats")
        self.chats.currentItemChanged.connect(self._pick)
        self.chats.setContextMenuPolicy(Qt.CustomContextMenu)
        self.chats.customContextMenuRequested.connect(self._chat_menu)
        sl.addWidget(self.chats, 1)
        self.net_lbl = label("", "small", wrap=True)
        self.net_lbl.setContentsMargins(16, 4, 12, 0)
        sl.addWidget(self.net_lbl)
        self.upd_btn = button("", "primary", fn=self.do_update)
        self.upd_btn.hide()
        upw = QWidget()
        upl = QHBoxLayout(upw)
        upl.setContentsMargins(12, 8, 12, 4)
        upl.addWidget(self.upd_btn)
        sl.addWidget(upw)
        self.updater = Updater()
        self.updater.found.connect(self._update_found)
        self.updater.progress.connect(lambda g, t: self.upd_btn.setText(
            f"Скачиваю… {g * 100 // t if t else 0}%"))
        self.updater.done.connect(self._update_ready)
        h.addWidget(side)

        # ---- справа: переписка
        right = QWidget()
        rl = QVBoxLayout(right)
        rl.setContentsMargins(0, 0, 0, 0)
        rl.setSpacing(0)
        head = QFrame()
        head.setObjectName("chathead")
        hl = QHBoxLayout(head)
        hl.setContentsMargins(16, 10, 16, 10)
        self.head_av = QLabel()
        hl.addWidget(self.head_av)
        hc = QVBoxLayout()
        hc.setSpacing(0)
        self.head_title = label("", "h3")
        self.head_sub = label("", "small")
        hc.addWidget(self.head_title)
        hc.addWidget(self.head_sub)
        hl.addLayout(hc, 1)
        rl.addWidget(head)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QFrame.NoFrame)
        self.msgs = MsgsArea()
        self.ml = QVBoxLayout(self.msgs)
        self.ml.setContentsMargins(16, 12, 16, 12)
        self.ml.setSpacing(6)
        self.ml.addStretch(1)
        self.scroll.setWidget(self.msgs)
        rl.addWidget(self.scroll, 1)

        # полоска «ответ на сообщение» над полем ввода
        self.reply_to = None
        self.reply_bar = QFrame()
        self.reply_bar.setObjectName("composer")
        rb = QHBoxLayout(self.reply_bar)
        rb.setContentsMargins(16, 6, 10, 0)
        rq = QFrame()
        rq.setStyleSheet(f"QFrame {{ border-left: 3px solid {P['accent']}; background: #EEF1F5; border-radius: 6px; }}"
                         "QLabel { background: transparent; border: 0; }")
        rql = QVBoxLayout(rq)
        rql.setContentsMargins(8, 4, 8, 4)
        rql.setSpacing(0)
        self.reply_name = QLabel()
        self.reply_name.setStyleSheet(f"font-weight:700; font-size:12px; color:{P['accent']}")
        self.reply_text = QLabel()
        self.reply_text.setStyleSheet(f"font-size:13px; color:{P['muted']}")
        rql.addWidget(self.reply_name)
        rql.addWidget(self.reply_text)
        rb.addWidget(rq, 1)
        rb.addWidget(button("✕", "icon", tip="Отменить ответ", fn=self.cancel_reply))
        self.reply_bar.hide()
        rl.addWidget(self.reply_bar)

        comp = QFrame()
        comp.setObjectName("composer")
        cl = QHBoxLayout(comp)
        cl.setContentsMargins(12, 10, 12, 10)
        cl.setSpacing(8)
        att = button("", "icon", icon="attach", tip="Отправить файл (или перетащите файлы в окно)",
                     fn=self.pick_files)
        att.setIconSize(QSize(24, 24))
        cl.addWidget(att, 0, Qt.AlignBottom)
        emo = button("🙂", "icon", tip="Смайлики", fn=self.show_emoji)
        emo.setStyleSheet("font-size:22px")
        cl.addWidget(emo, 0, Qt.AlignBottom)
        self._emo_btn = emo
        tk = button("📋", "icon", tip="Новое задание (карточка для цеха)", fn=self.new_task)
        tk.setStyleSheet("font-size:20px")
        cl.addWidget(tk, 0, Qt.AlignBottom)
        self.input = QPlainTextEdit()
        self.input.setObjectName("input")
        self.input.setPlaceholderText("Сообщение…   (Enter — отправить, Shift+Enter — новая строка)")
        self.input.setWordWrapMode(QTextOption.WrapAtWordBoundaryOrAnywhere)
        self.input.setFixedHeight(42)
        self.input.textChanged.connect(self._grow)
        self.input.installEventFilter(self)
        cl.addWidget(self.input, 1)
        self.send_btn = button("", "round", fn=self.send_text)
        self.send_btn.setIcon(QIcon(glyph("up", "#FFFFFF", 22, 2.4)))
        self.send_btn.setIconSize(QSize(22, 22))
        cl.addWidget(self.send_btn, 0, Qt.AlignBottom)
        rl.addWidget(comp)
        h.addWidget(right, 1)

        self.veil = QLabel("Отпустите — отправлю файлы в этот чат", root)
        self.veil.setAlignment(Qt.AlignCenter)
        self.veil.setStyleSheet(f"background:{P['veil']}; border:2px solid {P['accent']}; border-radius:18px;"
                                f"color:{P['accent']}; font-size:24px; font-weight:700")
        self.veil.hide()

        node.peers_changed.connect(self._peers_changed)
        node.message.connect(self._on_message)
        node.file_progress.connect(self._on_progress)
        node.task_changed.connect(self._task_changed)
        self._tray()
        self._refresh_timer = QTimer(self, singleShot=True, interval=300, timeout=self.fill_chats)
        self.fill_chats()
        self.open_chat(ALL)

    # ---------- список чатов
    def _peers_changed(self):
        self._refresh_timer.start()

    def fill_chats(self):
        if hasattr(self, "tray"):
            self.tray.setIcon(self._tray_icon())
        cur = self.chat
        self.chats.blockSignals(True)
        self.chats.clear()
        peers = sorted(self.node.peers(), key=lambda p: (not p["online"], p["name"].lower()))
        online = sum(p["online"] for p in peers)
        entries = [(ALL, "Общий чат", True, avatar("", "", 44, group=True))]
        for p in peers:
            entries.append((p["id"], p["name"] + (f" · {p['dept']}" if p["dept"] else ""), p["online"],
                            self._peer_avatar(p)))
        for key, title, on, pix in entries:
            last, unread = self.node.last_and_unread(key)
            if last:
                who = "Вы: " if last["mine"] else (f"{last['sender_name']}: " if key == ALL else "")
                preview = who + (("📎 " + last["file"]["name"]) if last["file"] and not last["text"] else last["text"])
                when = datetime.fromtimestamp(last["ts"] / 1000)
                when = when.strftime("%H:%M") if when.date() == datetime.now().date() else when.strftime("%d.%m")
            else:
                preview = "в сети" if on and key != ALL else ("не в сети" if key != ALL else "Сообщения для всех")
                when = ""
            it = QListWidgetItem()
            it.setData(ROLE, key)
            row = ChatRow(title, preview, when, unread if key != self.chat else 0, on, pix)
            it.setSizeHint(QSize(100, 64))
            self.chats.addItem(it)
            self.chats.setItemWidget(it, row)
            if key == cur:
                self.chats.setCurrentItem(it)
        self.chats.blockSignals(False)
        q = self.node.queued_count()
        srv = {None: "", True: "\nСервер: на связи ✓", False: "\nСервер: нет связи"}[self.node.relay_ok]
        self.net_lbl.setText(f"В сети: {online} из {len(peers)}" + (f" · в очереди: {q}" if q else "") + srv +
                             f"\nКод организации: {'•' * min(len(self.cfg['org']), 8)}")
        self._update_head()

    def _peer_avatar(self, p):
        pm = avatar(p["name"], p["id"], 44, photo=p.get("photo"))
        if p["online"]:
            q = QPainter(pm)
            q.setRenderHint(QPainter.Antialiasing)
            q.setPen(Qt.NoPen)
            q.setBrush(QColor("#FFFFFF"))
            q.drawEllipse(QRectF(31, 31, 14, 14))
            q.setBrush(QColor(P["ok"]))
            q.drawEllipse(QRectF(33, 33, 10, 10))
            q.end()
        return pm

    def _update_found(self, ver, _url):
        if self.upd_btn.isVisible():
            return
        self.upd_btn.setText(f"Обновить до версии {ver}")
        self.upd_btn.setEnabled(True)
        self.upd_btn.show()
        if getattr(self, "tray", None) is not None:
            self.tray.showMessage("Доступна новая версия RafChat",
                                  f"Версия {ver}. Нажмите «Обновить» внизу списка чатов.", self._tray_icon(), 8000)

    def do_update(self):
        if not (IS_WIN and getattr(sys, "frozen", False)):
            QDesktopServices.openUrl(QUrl("https://github.com/sharapovrafail-bot/modelview/releases/tag/rafchat-latest"))
            return
        if QMessageBox.question(self, "RafChat", f"Обновить RafChat до версии {self.updater.ver}?\n\n"
                                "Программа скачает установщик, закроется на несколько секунд и запустится снова. "
                                "Переписка и настройки сохранятся.") != QMessageBox.Yes:
            return
        self.upd_btn.setEnabled(False)
        self.upd_btn.setText("Скачиваю…")
        self.updater.download()

    def _update_ready(self, path):
        if not path:
            self.upd_btn.setEnabled(True)
            self.upd_btn.setText(f"Обновить до версии {self.updater.ver}")
            QMessageBox.warning(self, "RafChat", "Не удалось скачать обновление. Проверьте интернет и попробуйте ещё раз.")
            return
        import subprocess
        try:
            # установщик сам закроет RafChat, поставит новую версию и запустит её (Windows спросит разрешение)
            subprocess.Popen([path, "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/RELAUNCH"], close_fds=True)
        except OSError:
            os.startfile(path)                                         # type: ignore[attr-defined]
        self.node.stop()
        QApplication.quit()

    def show_emoji(self):
        panel = EmojiPanel(self)
        panel.picked.connect(lambda e: (self.input.insertPlainText(e), self.input.setFocus()))
        b = self._emo_btn
        panel.move(b.mapToGlobal(QPoint(0, -panel.height() - 6)))
        panel.show()

    def _chat_menu(self, pos):
        it = self.chats.itemAt(pos)
        if it is None:
            return
        key = it.data(ROLE)
        m = QMenu(self)
        if key == ALL:
            act = m.addAction("Очистить историю общего чата")
        else:
            act = m.addAction("Удалить чат")
        if m.exec(self.chats.viewport().mapToGlobal(pos)) is act:
            what = "Очистить историю «Общего чата» на этом ПК?" if key == ALL else \
                "Удалить этот чат и переписку на этом ПК?\n(Если человек снова появится в сети, чат вернётся.)"
            if QMessageBox.question(self, "RafChat", what) == QMessageBox.Yes:
                self.node.delete_chat(key)
                if self.chat == key:
                    self.open_chat(ALL)
                self.fill_chats()

    def _pick(self, it, _prev=None):
        if it is not None:
            self.open_chat(it.data(ROLE))

    # ---------- переписка
    def open_chat(self, key):
        self.chat = key
        self.node.mark_read(key)
        self.bubbles.clear()
        while self.ml.count() > 1:
            w = self.ml.takeAt(1).widget()
            if w:
                w.hide()
                w.deleteLater()
        last_day = None
        for m in self.node.history(key):
            last_day = self._add(m, last_day)
        self._update_head()
        QTimer.singleShot(50, self._to_bottom)
        self._refresh_timer.start()
        self.input.setFocus()

    def _update_head(self):
        if self.chat == ALL:
            peers = self.node.peers()
            on = sum(p["online"] for p in peers)
            self.head_av.setPixmap(avatar("", "", 38, group=True))
            self.head_title.setText("Общий чат")
            self.head_sub.setText(f"Участников: {len(peers) + 1}, в сети: {on + 1}")
        else:
            p = self.node.peer(self.chat)
            if not p:
                return
            self.head_av.setPixmap(avatar(p["name"], p["id"], 38, photo=p.get("photo")))
            self.head_title.setText(p["name"] + (f" · {p['dept']}" if p["dept"] else ""))
            if p["online"]:
                kind = {"android": " · телефон", "ios": " · iPhone"}.get(p["plat"], "")
                self.head_sub.setText(("в сети" if p["lan"] else "в сети через интернет") + kind)
            else:
                seen = datetime.fromtimestamp(p["last_seen"]).strftime("%d.%m %H:%M") if p["last_seen"] else "—"
                self.head_sub.setText(f"не в сети, был(а) {seen} — сообщения дойдут, когда появится")

    def _add(self, m, last_day):
        day = datetime.fromtimestamp(m["ts"] / 1000).date()
        if day != last_day:
            today = datetime.now().date()
            txt = "Сегодня" if day == today else ("Вчера" if (today - day).days == 1 else day.strftime("%d.%m.%Y"))
            d = QLabel(txt)
            d.setObjectName("day")
            row = QHBoxLayout()
            w = QWidget()
            w.setLayout(row)
            row.setContentsMargins(0, 6, 0, 6)
            row.addStretch(1)
            row.addWidget(d)
            row.addStretch(1)
            self.ml.addWidget(w)
        b = Bubble(self, m, self.chat == ALL)
        w = QWidget()
        row = QHBoxLayout(w)
        row.setContentsMargins(0, 0, 0, 0)
        if m["mine"]:
            row.addStretch(1)
            row.addWidget(b)
        else:
            row.addWidget(b)
            row.addStretch(1)
        self.ml.addWidget(w)
        self.bubbles[m["id"]] = b
        return day

    def _to_bottom(self):
        sb = self.scroll.verticalScrollBar()
        sb.setValue(sb.maximum())

    def _on_message(self, mid, new):
        m = self.node.msg(mid)
        if not m:
            return
        if m["chat"] == self.chat:
            if mid in self.bubbles:
                self.bubbles[mid].refresh(m)
            elif new:
                self._add(m, datetime.fromtimestamp(m["ts"] / 1000).date() if self.bubbles else None)
                QTimer.singleShot(30, self._to_bottom)
            if self.isActiveWindow():
                self.node.mark_read(self.chat)
        if new and not m["mine"]:
            if not (self.isActiveWindow() and m["chat"] == self.chat):
                body = ("📎 " + m["file"]["name"]) if m["file"] and not m["text"] else m["text"]
                where = "Общий чат · " if m["chat"] == ALL else ""
                self._notify_chat = m["chat"]
                self.tray.showMessage(f"{where}{m['sender_name']}", body[:200], self._tray_icon(), 6000)
                QApplication.alert(self)             # мигает кнопка на панели задач
        self._refresh_timer.start()

    def _task_changed(self, mid, who, status):
        m = self.node.msg(mid)
        if not m or not hasattr(self, "tray"):
            return
        self._notify_chat = m["chat"]
        self.tray.showMessage(f"Задание: {m['task'].get('title', '')}", f"{who}: {status}", self._tray_icon(), 6000)

    def _on_progress(self, mid, got, total):
        b = self.bubbles.get(mid)
        if b and hasattr(b, "bar"):
            b.progress(got, total)

    # ---------- ввод
    def eventFilter(self, obj, ev):
        if obj is self.input and ev.type() == ev.Type.KeyPress and ev.key() in (Qt.Key_Return, Qt.Key_Enter) \
                and not ev.modifiers() & Qt.ShiftModifier:
            self.send_text()
            return True
        return super().eventFilter(obj, ev)

    def _grow(self):
        lines = max(1, min(6, int(self.input.document().size().height())))
        self.input.setFixedHeight(min(42 + (lines - 1) * 20, 150))

    def send_text(self):
        t = self.input.toPlainText().strip()
        if not t:
            return
        self.input.clear()
        self.node.send(self.chat, t, reply=self._take_reply())

    # ---------- ответ на сообщение
    def start_reply(self, m):
        self.reply_to = {"id": m["id"], "name": self.cfg["name"] if m["mine"] else m["sender_name"], "text": snippet(m)}
        self.reply_name.setText("Ответ: " + self.reply_to["name"])
        self.reply_text.setText(self.reply_to["text"])
        self.reply_bar.show()
        self.input.setFocus()

    def cancel_reply(self):
        self.reply_to = None
        self.reply_bar.hide()

    def _take_reply(self):
        r = self.reply_to
        self.cancel_reply()
        return r

    # ---------- задания
    def new_task(self):
        d = TaskDialog(self.node.peers(), self)
        if d.exec() == QDialog.Accepted:
            t = d.value()
            tid = self.node.send(self.chat, task_fallback(t), task=t, reply=self._take_reply())
            self._send_task_files(tid, t, d.files)

    def _send_task_files(self, tid, t, files):
        """Файлы к заданию уходят следом, ответом на карточку."""
        rp = {"id": tid, "name": self.cfg["name"], "text": "📋 " + t.get("title", "задание")}
        for p in files:
            if p.is_file():
                self.node.send(self.chat, "", p, reply=rp)

    def attach_to_task(self, m):
        paths, _ = QFileDialog.getOpenFileNames(self, "Файлы к заданию «%s»" % m["task"].get("title", ""),
                                                str(Path.home()))
        if paths:
            if m["chat"] != self.chat:
                self.open_chat(m["chat"])
            rp = {"id": m["id"], "name": m["sender_name"], "text": "📋 " + m["task"].get("title", "задание")}
            for p in paths:
                self.node.send(m["chat"], "", Path(p), reply=rp)

    def show_tasks(self):
        self.search.blockSignals(True)
        self.search.clear()
        self.search.blockSignals(False)
        items = self.node.tasks()
        order = {TASK_REWORK: 0, TASK_WORK: 1, TASK_NEW: 2, TASK_DONE: 3, TASK_OK: 4}
        items.sort(key=lambda m: (order.get(m["task"].get("status"), 9), -m["ts"]))
        self._show_results(items, "Заданий пока нет — создайте кнопкой 📋 рядом с полем ввода.", tasks=True)

    # ---------- поиск
    def _do_search(self, text):
        text = text.strip()
        if len(text) < 2:
            self.results.hide()
            self.chats.show()
            return
        self._show_results(self.node.search(text), "Ничего не найдено.")

    def _chat_title(self, chat):
        if chat == ALL:
            return "Общий чат"
        p = self.node.peer(chat)
        return p["name"] if p else "?"

    def _show_results(self, items, empty, tasks=False):
        self.results.clear()
        if not items:
            it = QListWidgetItem(empty)
            it.setFlags(Qt.NoItemFlags)
            self.results.addItem(it)
        for m in items:
            when = datetime.fromtimestamp(m["ts"] / 1000).strftime("%d.%m %H:%M")
            if tasks:
                t = m["task"]
                extra = f" · {due_info(t['due'])[0]}" if t.get("due") and t.get("status") not in (TASK_DONE, TASK_OK) else ""
                txt = f"📋 {t.get('title', '')} — {t.get('status', TASK_NEW)}\n{self._chat_title(m['chat'])}{extra}"
            else:
                who = "Вы" if m["mine"] else m["sender_name"]
                txt = f"{self._chat_title(m['chat'])} · {who} · {when}\n{snippet(m, 90)}"
            it = QListWidgetItem(txt)
            it.setData(ROLE, (m["chat"], m["id"]))
            it.setSizeHint(QSize(280, 58))
            self.results.addItem(it)
        self.chats.hide()
        self.results.show()

    def _open_result(self, it):
        d = it.data(ROLE)
        if d:
            self.jump_to(*d)

    def jump_to(self, chat, mid):
        """Открыть чат и прокрутить к сообщению, подсветив его."""
        if chat != self.chat:
            self.open_chat(chat)
        QTimer.singleShot(120, lambda: self._scroll_to(mid))

    def _scroll_to(self, mid):
        b = self.bubbles.get(mid)
        if b is None:
            return
        self.scroll.ensureWidgetVisible(b, 0, 120)
        b.flash()

    def pick_files(self):
        paths, _ = QFileDialog.getOpenFileNames(self, "Файлы для отправки", str(Path.home()))
        self.send_files([Path(p) for p in paths])

    def send_files(self, paths):
        reply = self._take_reply()
        for p in paths:
            if p.is_file():
                self.node.send(self.chat, "", p, reply=reply)
                reply = None

    def dragEnterEvent(self, ev):
        if ev.mimeData().hasUrls():
            self.veil.setGeometry(self.centralWidget().rect().adjusted(320, 10, -10, -10))
            self.veil.show()
            self.veil.raise_()
            ev.acceptProposedAction()

    def dragLeaveEvent(self, ev):
        self.veil.hide()

    def dropEvent(self, ev):
        self.veil.hide()
        self.send_files([Path(u.toLocalFile()) for u in ev.mimeData().urls() if u.isLocalFile()])
        ev.acceptProposedAction()

    def changeEvent(self, ev):
        super().changeEvent(ev)
        if ev.type() == ev.Type.ActivationChange and self.isActiveWindow():
            self.node.mark_read(self.chat)
            self._refresh_timer.start()

    # ---------- трей, настройки
    def _downloads(self) -> Path:
        p = Path(self.cfg.get("downloads") or default_downloads())
        p.mkdir(parents=True, exist_ok=True)
        return p

    def _tray(self):
        self.tray = QSystemTrayIcon(QIcon(C.app_icon_pixmap()), self)
        m = QMenu()
        m.addAction("Открыть RafChat", self.show_normal)
        m.addAction("Папка с файлами", lambda: open_local(self._downloads()))
        m.addSeparator()
        m.addAction("Выход", self.quit)
        self.tray.setContextMenu(m)
        self.tray.activated.connect(lambda r: self.show_normal() if r in (QSystemTrayIcon.Trigger,
                                                                          QSystemTrayIcon.DoubleClick) else None)
        self.tray.messageClicked.connect(self._open_notified)
        self.tray.setToolTip("RafChat")
        self.tray.show()

    def _open_notified(self):
        """Щелчок по уведомлению — открыть окно сразу в нужном чате (как в WhatsApp)."""
        self.show_normal()
        chat = getattr(self, "_notify_chat", None)
        if chat:
            self.open_chat(chat)

    def _tray_icon(self) -> QIcon:
        """Значок у часов с красным кружком непрочитанных."""
        total = sum(self.node.last_and_unread(k)[1] for k in [ALL] + [p["id"] for p in self.node.peers()])
        pm = C.app_icon_pixmap(64)
        if total:
            p = QPainter(pm)
            p.setRenderHint(QPainter.Antialiasing)
            p.setPen(Qt.NoPen)
            p.setBrush(QColor("#FF3B30"))
            p.drawEllipse(QRectF(26, 0, 38, 38))
            f = QFont()
            f.setPixelSize(26 if total < 10 else 20)
            f.setWeight(QFont.Bold)
            p.setFont(f)
            p.setPen(QColor("#FFFFFF"))
            p.drawText(QRectF(26, 0, 38, 38), Qt.AlignCenter, str(total) if total < 100 else "99")
            p.end()
        self.tray.setToolTip(f"RafChat — непрочитанных: {total}" if total else "RafChat")
        return QIcon(pm)

    def show_normal(self):
        self.show()
        self.setWindowState(self.windowState() & ~Qt.WindowMinimized)
        self.raise_()
        self.activateWindow()

    def closeEvent(self, ev):
        if getattr(self, "_quitting", False) or not QSystemTrayIcon.isSystemTrayAvailable():
            self.node.stop()
            ev.accept()
            return
        ev.ignore()
        self.hide()
        if not self.cfg.get("hint_tray"):
            self.cfg["hint_tray"] = True
            save_cfg(self.cfg)
            self.tray.showMessage("RafChat работает в фоне", "Сообщения по-прежнему приходят. Значок — у часов.",
                                  QIcon(C.app_icon_pixmap()), 5000)

    def quit(self):
        self._quitting = True
        self.node.stop()
        self.tray.hide()
        QApplication.quit()

    def settings(self):
        d = ProfileDialog(self.cfg, first=False, parent=self)
        if d.exec():
            save_cfg(self.cfg)
            if not self.cfg.get("relay_alt"):
                self.node._alt_port, self.node._alt_tls = None, False
            QMessageBox.information(self, "RafChat", "Настройки сохранены. Имя и отдел увидят остальные через "
                                    "несколько секунд, сервер подключится сам; код организации применится "
                                    "после перезапуска.")
            self.me_lbl.setText(self._me_text())

    def choose_photo(self):
        f, _ = QFileDialog.getOpenFileName(self, "Фото профиля", str(Path.home() / "Pictures"),
                                           "Изображения (*.jpg *.jpeg *.png *.webp *.bmp)")
        if not f:
            return
        jpeg = make_avatar_jpeg(f)
        if not jpeg:
            QMessageBox.warning(self, "RafChat", "Не удалось открыть это изображение.")
            return
        self.node.set_avatar(jpeg)
        self.me_lbl.setText(self._me_text())
        QMessageBox.information(self, "RafChat", "Фото профиля обновлено — коллеги увидят его через несколько секунд.")

    def setup_server(self):
        d = ServerSetupDialog(self.cfg, self)
        if d.exec() and d.address:
            self.node.set_server(d.address)
            self._refresh_timer.start()

    def _me_text(self):
        return f"Вы: {self.cfg['name']}" + (f" · {self.cfg['dept']}" if self.cfg.get("dept") else "")

    def about(self):
        QMessageBox.about(self, "О программе RafChat",
                          f"<h2>RafChat {APP_VER}</h2><p>Чат и передача файлов по локальной сети организации — "
                          f"без сервера и интернета.</p><p>Автор: <b>{APP_AUTHOR}</b><br>"
                          f"<a href='mailto:{APP_EMAIL}'>{APP_EMAIL}</a><br>{APP_COPYRIGHT}. Все права защищены.</p>")


def server_files() -> tuple[Path, Path]:
    """Файлы сервера, которые программа везёт с собой (в сборке — рядом с программой)."""
    base = Path(getattr(sys, "_MEIPASS", "")) / "server" if getattr(sys, "frozen", False) \
        else Path(__file__).resolve().parent.parent / "server"
    return base / "rafchat_relay.py", base / "install.sh"


class ServerSetupDialog(QDialog):
    """Установка сервера-ретранслятора на VPS по SSH — без захода в консоль хостинга."""
    log_line = Signal(str)
    finished_ok = Signal(str)
    failed = Signal(str)

    def __init__(self, cfg: dict, parent=None):
        super().__init__(parent)
        self.cfg = cfg
        self.address = ""
        self.setWindowTitle("Установка сервера RafChat на VPS")
        self.setMinimumSize(560, 560)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(22, 20, 22, 18)
        lay.setSpacing(8)
        lay.addWidget(label("Сервер для работы через интернет", "h2"))
        lay.addWidget(label("RafChat сам подключится к вашему VPS по SSH, поставит сервер, откроет порт 47888 "
                            "и проверит работу. Пароль никуда не сохраняется. VPN и другие службы на сервере "
                            "не затрагиваются.", "muted", wrap=True))
        c, cl = card(lay, (16, 12, 16, 12), 6)
        row = QHBoxLayout()
        self.host = QLineEdit()
        self.host.setPlaceholderText("IP-адрес VPS, например 185.12.34.56")
        self.sshport = QLineEdit("22")
        self.sshport.setFixedWidth(70)
        row.addWidget(self.host, 1)
        row.addWidget(self.sshport)
        cl.addWidget(label("Адрес VPS и порт SSH", "label"))
        cl.addLayout(row)
        cl.addWidget(label("Логин", "label"))
        self.user = QLineEdit("root")
        cl.addWidget(self.user)
        cl.addWidget(label("Пароль (из письма Fornex / панели управления)", "label"))
        self.pw = QLineEdit()
        self.pw.setEchoMode(QLineEdit.Password)
        self.pw.setPlaceholderText("если вход по ключу SSH — оставьте пустым")
        cl.addWidget(self.pw)
        from PySide6.QtWidgets import QCheckBox
        self.force = QCheckBox("Переустановить / обновить сервер, даже если он уже работает")
        cl.addWidget(self.force)
        srv = (cfg.get("server") or "").strip()
        if srv:
            self.host.setText(srv.rsplit(":", 1)[0])
        self.log = QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setPlaceholderText("Здесь будет ход установки…")
        self.log.setStyleSheet(f"background:{P['surface']}; border-radius:12px; font-family:Consolas,monospace;"
                               f"font-size:12px; padding:8px")
        lay.addWidget(self.log, 1)
        self.go = button("Установить", "primary", fn=self.start)
        lay.addWidget(self.go)
        self.log_line.connect(self.log.appendPlainText)
        self.finished_ok.connect(self._ok)
        self.failed.connect(self._fail)

    def start(self):
        # защита от типичных ошибок ввода: «root 1.2.3.4», «root@1.2.3.4», «1.2.3.4:47888», порт 47888 в поле SSH
        host = self.host.text().strip().replace("ssh ", "").split("@")[-1].split()[0] if self.host.text().strip() else ""
        host = host.split(":")[0]
        user = (self.user.text().strip() or "root").split("@")[0].split()[0]
        try:
            sport = int(self.sshport.text() or 22)
        except ValueError:
            sport = 22
        self.log.clear()
        if sport == 47888:
            sport = 22
            self.sshport.setText("22")
            self.log.appendPlainText("Порт 47888 — это порт самого RafChat; для SSH использую 22.")
        if not host:
            self.log.appendPlainText("Укажите IP-адрес VPS.")
            return
        self.host.setText(host)
        self.user.setText(user)
        self.go.setEnabled(False)
        self.go.setText("Устанавливаю…")
        args = (host, sport, user, self.pw.text())
        threading.Thread(target=self._work, args=args, daemon=True).start()

    def _relay_alive(self, host) -> bool:
        try:
            c = http.client.HTTPConnection(host, 47888, timeout=4)
            c.request("GET", "/")
            r = c.getresponse()
            ok = r.status == 200 and b"RafChat" in r.read()
            c.close()
            return ok
        except OSError:
            return False

    def _work(self, host, port, user, pw):
        if not self.force.isChecked() and self._relay_alive(host):
            self.log_line.emit(f"Сервер RafChat на {host}:47888 уже работает — подключаю без установки.")
            self.finished_ok.emit(f"{host}:47888")
            return
        try:
            import paramiko
            import shlex
            relay, inst = server_files()
            self.log_line.emit(f"Подключаюсь к {user}@{host}:{port}…")
            cli = paramiko.SSHClient()
            cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            cli.connect(host, port=port, username=user, password=pw or None, timeout=20,
                        allow_agent=not pw, look_for_keys=not pw)
            self.log_line.emit("Подключено. Загружаю сервер…")
            sftp = cli.open_sftp()
            for local, remote in ((relay, "/tmp/rafchat_relay.py"), (inst, "/tmp/rafchat_install.sh")):
                with sftp.open(remote, "wb") as fh:
                    fh.write(local.read_bytes().replace(b"\r\n", b"\n"))
            sftp.close()
            cmd = "RAFCHAT_RELAY_SRC=/tmp/rafchat_relay.py bash /tmp/rafchat_install.sh"
            if user != "root":
                cmd = (f"echo {shlex.quote(pw)} | sudo -S -p '' env RAFCHAT_RELAY_SRC=/tmp/rafchat_relay.py "
                       f"bash /tmp/rafchat_install.sh")
            _, out, _ = cli.exec_command(cmd + " 2>&1", get_pty=True)
            address = ""
            for line in iter(out.readline, ""):
                line = line.rstrip()
                if line.startswith("RAFCHAT_ADDRESS="):
                    address = line.split("=", 1)[1].strip()
                    continue
                if line:
                    self.log_line.emit(line)
            code = out.channel.recv_exit_status()
            cli.close()
            if code != 0:
                raise RuntimeError(f"установка завершилась с ошибкой (код {code})")
            address = f"{host}:{address.rsplit(':', 1)[-1] if address else 47888}"
            self.log_line.emit(f"Проверяю доступ к {address} отсюда…")
            h, p_ = address.rsplit(":", 1)
            c = http.client.HTTPConnection(h, int(p_), timeout=8)
            c.request("GET", "/")
            ok = c.getresponse().status == 200
            c.close()
            if not ok:
                raise RuntimeError("сервер установлен, но с ПК недоступен — откройте TCP-порт 47888 "
                                   "в панели Fornex (брандмауэр)")
            self.finished_ok.emit(address)
        except Exception as e:  # noqa
            msg = str(e) or type(e).__name__
            if "Authentication" in type(e).__name__ or "authentication" in msg.lower():
                msg = "неверный логин или пароль"
            elif isinstance(e, (socket.timeout, TimeoutError)) or "timed out" in msg:
                msg = "VPS не отвечает — проверьте IP-адрес и порт SSH"
            self.failed.emit(msg)

    def _ok(self, address):
        self.address = address
        self.log.appendPlainText(f"\n✓ Готово. Сервер работает: {address}\n"
                                 "Адрес сохранён. Остальные ПК и телефоны организации получат его сами, "
                                 "как только окажутся в одной сети с этим ПК.")
        self.go.setEnabled(True)
        self.go.setText("Закрыть")
        self.go.clicked.disconnect()
        self.go.clicked.connect(self.accept)

    def _fail(self, msg):
        self.log.appendPlainText(f"\n✗ Не получилось: {msg}")
        self.go.setEnabled(True)
        self.go.setText("Попробовать ещё раз")


class TaskDialog(QDialog):
    """Новое задание для цеха: деталь, чертёж/УП, материал, количество, срок, исполнитель."""

    def __init__(self, peers, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Новое задание")
        self.setMinimumWidth(460)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(22, 18, 22, 18)
        lay.setSpacing(6)
        lay.addWidget(label("📋 Новое задание", "h2"))
        c, cl = card(lay, (16, 12, 16, 14), 4)

        def row(title, w):
            cl.addWidget(label(title, "label"))
            cl.addWidget(w)
            return w
        self.title = row("Деталь / что сделать *", QLineEdit())
        self.title.setPlaceholderText("например: Вал Ø32 h6")
        self.drawing = row("Чертёж / номер программы", QLineEdit())
        self.drawing.setPlaceholderText("например: ВЛ-032.01, O1025")
        mq = QHBoxLayout()
        self.material = QComboBox()
        self.material.setEditable(True)
        self.material.addItems(["", "40Х", "45", "45Х", "Ст3", "12Х18Н10Т", "20Х13", "Д16Т", "АМг6", "Латунь ЛС59"])
        self.qty = QSpinBox()
        self.qty.setRange(0, 100000)
        self.qty.setSuffix(" шт")
        self.qty.setValue(1)
        mcol, qcol = QVBoxLayout(), QVBoxLayout()
        mcol.addWidget(label("Материал", "label"))
        mcol.addWidget(self.material)
        qcol.addWidget(label("Количество", "label"))
        qcol.addWidget(self.qty)
        mq.addLayout(mcol, 2)
        mq.addLayout(qcol, 1)
        cl.addLayout(mq)
        dw = QHBoxLayout()
        from PySide6.QtCore import QDate
        self.due = QDateEdit(QDate.currentDate().addDays(3))
        self.due.setCalendarPopup(True)
        self.due.setDisplayFormat("dd.MM.yyyy")
        self.no_due = QComboBox()
        self.no_due.addItems(["со сроком", "без срока"])
        self.no_due.currentIndexChanged.connect(lambda i: self.due.setEnabled(i == 0))
        dcol, wcol = QVBoxLayout(), QVBoxLayout()
        dcol.addWidget(label("Срок", "label"))
        d2 = QHBoxLayout()
        d2.addWidget(self.due, 1)
        d2.addWidget(self.no_due)
        dcol.addLayout(d2)
        self.who = QComboBox()
        self.who.setEditable(True)
        self.who.addItems([""] + sorted({p["name"] for p in peers}))
        wcol.addWidget(label("Исполнитель", "label"))
        wcol.addWidget(self.who)
        dw.addLayout(dcol, 1)
        dw.addLayout(wcol, 1)
        cl.addLayout(dw)
        for w in (self.qty, self.due, self.no_due, self.material, self.who):
            w.setMinimumHeight(38)
        self.note = row("Примечание", QPlainTextEdit())
        self.note.setPlaceholderText("допуски, квалитет, шероховатость, что важно…")
        self.note.setFixedHeight(70)
        self.files: list = []
        fr = QHBoxLayout()
        fr.addWidget(button("📎 Прикрепить файлы / фото…", "tinted", fn=self._pick))
        self.files_lbl = label("модель, УП, чертёж, фото — уйдут вместе с заданием", "small", wrap=True)
        fr.addWidget(self.files_lbl, 1)
        lay.addLayout(fr)
        self.err = label("", "err")
        lay.addWidget(self.err)
        bl = QHBoxLayout()
        bl.addStretch(1)
        bl.addWidget(button("Отмена", "tinted", fn=self.reject))
        bl.addWidget(button("Отправить задание", "primary", fn=self._ok))
        lay.addLayout(bl)

    def _pick(self):
        paths, _ = QFileDialog.getOpenFileNames(self, "Файлы к заданию", str(Path.home()))
        for p in paths:
            if Path(p) not in self.files:
                self.files.append(Path(p))
        if self.files:
            names = ", ".join(p.name for p in self.files[:4]) + (f" и ещё {len(self.files) - 4}" if len(self.files) > 4 else "")
            self.files_lbl.setText(f"Прикреплено: {names}")

    def _ok(self):
        if len(self.title.text().strip()) < 2:
            self.err.setText("Укажите деталь или что нужно сделать.")
            return
        self.accept()

    def value(self) -> dict:
        t = {"title": self.title.text().strip()[:120], "drawing": self.drawing.text().strip()[:80],
             "material": self.material.currentText().strip()[:40], "qty": self.qty.value() or "",
             "due": self.due.date().toString("dd.MM.yyyy") if self.no_due.currentIndex() == 0 else "",
             "who": self.who.currentText().strip()[:60], "note": self.note.toPlainText().strip()[:600]}
        return {k: v for k, v in t.items() if v not in ("", None)}


class ProfileDialog(QDialog):
    def __init__(self, cfg: dict, first: bool, parent=None):
        super().__init__(parent)
        self.cfg = cfg
        self.setWindowTitle("RafChat — профиль" if not first else "Добро пожаловать в RafChat")
        self.setMinimumWidth(460)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(24, 22, 24, 20)
        lay.setSpacing(8)
        if first:
            ic = QLabel()
            pm = C.app_icon_pixmap(144)
            pm.setDevicePixelRatio(2)
            ic.setPixmap(pm)
            ic.setAlignment(Qt.AlignCenter)
            lay.addWidget(ic)
            t = label("RafChat", "h1")
            t.setAlignment(Qt.AlignCenter)
            lay.addWidget(t)
            s = label("Чат и файлы по локальной сети организации", "muted")
            s.setAlignment(Qt.AlignCenter)
            lay.addWidget(s)
            lay.addSpacing(8)
        c, cl = card(lay, (16, 14, 16, 14), 6)
        cl.addWidget(label("Ваше имя (как вас увидят коллеги)", "label"))
        self.name = QLineEdit(cfg.get("name", ""))
        self.name.setPlaceholderText("например: Рафаил Шарапов")
        cl.addWidget(self.name)
        cl.addWidget(label("Отдел или участок (необязательно)", "label"))
        self.dept = QLineEdit(cfg.get("dept", ""))
        self.dept.setPlaceholderText("например: Цех ЧПУ")
        cl.addWidget(self.dept)
        cl.addWidget(label("Код организации — одинаковый у всех", "label"))
        self.org = QLineEdit(cfg.get("org", ""))
        self.org.setPlaceholderText("придумайте и сообщите коллегам")
        cl.addWidget(self.org)
        cl.addWidget(label("Только устройства с этим кодом видят друг друга и могут писать.", "small", wrap=True))
        if not first:
            cl.addWidget(label("Адреса других ПК, если они не находятся сами (через запятую)", "label"))
            self.extra = QLineEdit(cfg.get("extra", ""))
            self.extra.setPlaceholderText("например: 192.168.1.20, 192.168.1.21")
            cl.addWidget(self.extra)
            cl.addWidget(label("Сервер для работы через интернет (из дома, в дороге)", "label"))
            self.server = QLineEdit(cfg.get("server", ""))
            self.server.setPlaceholderText("адрес:порт вашего сервера, например 203.0.113.5:47888")
            cl.addWidget(self.server)
            cl.addWidget(label("Одинаковый у всех. Переписка шифруется кодом организации — сервер её не видит.",
                               "small", wrap=True))
        self.err = label("", "err", wrap=True)
        lay.addWidget(self.err)
        ok = button("Начать" if first else "Сохранить", "primary", fn=self._ok)
        lay.addWidget(ok)

    def _ok(self):
        name, org = self.name.text().strip(), self.org.text().strip()
        if len(name) < 2:
            self.err.setText("Укажите имя.")
            return
        if len(org) < 4:
            self.err.setText("Код организации — не короче 4 символов.")
            return
        self.cfg.update(name=name[:60], dept=self.dept.text().strip()[:40], org=org)
        if hasattr(self, "extra"):
            self.cfg["extra"] = self.extra.text().strip()
            new_srv = self.server.text().strip()
            if new_srv != (self.cfg.get("server") or "").strip():
                self.cfg["server"] = new_srv
                self.cfg["srvt"] = time.time()           # новый адрес разойдётся по всем устройствам
                self.cfg["relay_alt"] = None
        self.accept()


# ======================================================================= запуск

def main():
    args = sys.argv[1:]
    if IS_WIN:
        try:
            import ctypes
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Sharapov.RafChat")
        except Exception:
            pass
    app = QApplication(sys.argv)
    if "--make-icon" in args:
        C.app_icon_pixmap(256).save(args[args.index("--make-icon") + 1])
        return
    app.setApplicationName("RafChat")
    app.setQuitOnLastWindowClosed(False)
    f = QFont("Segoe UI Variable Text" if IS_WIN else "Inter")
    f.setPixelSize(15)
    app.setFont(f)
    app.setStyleSheet(chat_qss())

    single = f"RafChat-{TCP_PORT}"
    sock = QLocalSocket()
    sock.connectToServer(single)
    if sock.waitForConnected(300):
        sock.write(b"show")
        sock.flush()
        sock.waitForBytesWritten(300)
        return
    QLocalServer.removeServer(single)
    srv = QLocalServer()
    srv.listen(single)

    cfg = load_cfg()
    cfg.setdefault("id", uuid.uuid4().hex)
    if not (cfg.get("server") or "").strip() and defaults().get("server"):
        cfg["server"] = defaults()["server"]          # адрес сервера встроен в установщик
    if "--screenshot" in args and not cfg.get("name"):
        cfg.update(name="Проверка", org="test")
    if not cfg.get("name") or not cfg.get("org"):
        d = ProfileDialog(cfg, first=True)
        if not d.exec():
            return
    save_cfg(cfg)
    node = Node(cfg)
    try:
        node.start()
    except RuntimeError as e:
        QMessageBox.critical(None, "RafChat", str(e))
        return
    win = ChatWindow(node, cfg)
    win.me_lbl.setText(win._me_text())
    srv.newConnection.connect(lambda: (srv.nextPendingConnection(), win.show_normal()))
    if "--screenshot" in args:
        out = args[args.index("--screenshot") + 1]
        win.show()
        QTimer.singleShot(2500, lambda: (win.grab().save(out), node.stop(), app.quit()))
    elif "--tray" not in args:
        win.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
