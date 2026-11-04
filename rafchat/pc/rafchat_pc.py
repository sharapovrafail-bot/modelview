"""RafChat — чат и передача файлов по локальной сети организации, без сервера.

Каждый ПК/телефон раз в несколько секунд сообщает в сеть «я здесь» (UDP 47800) и принимает
сообщения и файлы на своём порту (TCP 47801). Все участники вводят один «код организации»:
им подписываются все пакеты и запросы — чужие устройства в сети не видны и подделать сообщение не могут.
Сообщение выключенному получателю ждёт в очереди у отправителя и уходит, когда тот появится.
"""
from __future__ import annotations

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
from PySide6.QtWidgets import (QApplication, QDialog, QFileDialog, QFrame, QHBoxLayout, QLabel, QLineEdit,
                               QListWidget, QListWidgetItem, QMainWindow, QMenu, QMessageBox, QPlainTextEdit,
                               QProgressBar, QScrollArea, QSizePolicy, QSystemTrayIcon, QVBoxLayout, QWidget)

import common as C
from common import P, button, card, glyph, human, label, open_local, show_in_folder, type_icon

APP_VER = "0.1.2"
APP_AUTHOR = "Рафаил Шарапов"
APP_EMAIL = "rafail@sharapov-cnc.ru"
APP_COPYRIGHT = "© 2026 Рафаил Шарапов"
IS_WIN = sys.platform == "win32"

UDP_PORT = int(os.environ.get("RAFCHAT_UDP") or 47800)
TCP_PORT = int(os.environ.get("RAFCHAT_PORT") or 47801)
DATA_DIR = Path(os.environ.get("RAFCHAT_HOME") or
                Path(os.environ.get("APPDATA") or Path.home() / ".config") / "RafChat")
AUTO_DOWNLOAD = 50 * 1024 * 1024        # файлы до 50 МБ скачиваются сами
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


def avatar(name: str, key: str, size=40, group=False) -> QPixmap:
    pm = QPixmap(size * 2, size * 2)
    pm.setDevicePixelRatio(2)
    pm.fill(Qt.transparent)
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.setPen(Qt.NoPen)
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
    file_progress = Signal(str, int, int)    # id сообщения, принято, всего

    def __init__(self, cfg: dict):
        super().__init__()
        self.cfg = cfg
        self.id = cfg["id"]
        self.key = hashlib.sha256(("RafChat:" + cfg["org"].strip()).encode()).digest()
        self.store = Store(DATA_DIR / "rafchat.db")
        self._downloading: set = set()
        self._wake = threading.Event()
        self.running = True

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

    def stop(self):
        self.running = False
        try:
            self.beacon(bye=True)
        except Exception:
            pass

    # ---------- маяк «я здесь»
    def _beacon_payload(self, ask=False, bye=False) -> bytes:
        d = {"app": "RafChat", "v": 1, "id": self.id, "name": self.cfg["name"], "dept": self.cfg.get("dept", ""),
             "port": TCP_PORT, "plat": "pc", "ask": ask, "bye": bye}
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
                "port": TCP_PORT, "plat": "pc"}

    def _upsert(self, d, ip):
        """Запомнить участника (из маяка, сообщения или ответа на /ping). Возвращает (был ли известен, был ли в сети)."""
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
            self._catch_up(d["id"])
        if not was_online:
            self._wake.set()                        # у нас может быть очередь для него
            self.peers_changed.emit()
        return bool(prev), was_online

    def _catch_up(self, pid):
        """Новый участник: дослать ему мои сообщения «Общего чата» за последние сутки."""
        since = now_ms() - 86400 * 1000
        for mid, ts, text, file, status in self.store.q(
                "SELECT id,ts,text,file,status FROM messages WHERE chat=? AND mine=1 AND ts>?", (ALL, since)):
            m = {"id": mid, "from": self.id, "name": self.cfg["name"], "to": ALL, "ts": ts, "text": text or "",
                 "file": json.loads(file) if file else None, "port": TCP_PORT}
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
                if p["ip"] and time.time() - p["last_seen"] > 8:
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
        rows = self.store.q("SELECT id,name,dept,ip,port,plat,last_seen FROM peers")
        return [dict(id=r[0], name=r[1], dept=r[2], ip=r[3], port=r[4], plat=r[5],
                     online=time.time() - (r[6] or 0) < ONLINE_SEC, last_seen=r[6] or 0) for r in rows]

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
    def send(self, chat: str, text: str = "", file: Path | None = None) -> str:
        mid = uuid.uuid4().hex
        fmeta = None
        if file is not None:
            fid = uuid.uuid4().hex
            self.store.q("INSERT INTO files(fid,path) VALUES(?,?)", (fid, str(file)))
            fmeta = {"fid": fid, "name": file.name, "size": file.stat().st_size}
        m = {"id": mid, "from": self.id, "name": self.cfg["name"], "to": chat, "ts": now_ms(), "text": text,
             "file": fmeta, "port": TCP_PORT}
        targets = [p["id"] for p in self.peers()] if chat == ALL else [chat]
        status = f"0/{len(targets)}" if chat == ALL else "queued"
        self.store.q("INSERT INTO messages(id,chat,sender,sender_name,ts,text,file,mine,status,local) "
                     "VALUES(?,?,?,?,?,?,?,1,?,?)",
                     (mid, chat, self.id, self.cfg["name"], m["ts"], text, json.dumps(fmeta) if fmeta else None,
                      status, str(file) if file else None))
        payload = json.dumps(m, ensure_ascii=False)
        for t in targets:
            self.store.q("INSERT OR IGNORE INTO outbox(peer,msg_id,payload) VALUES(?,?,?)", (t, mid, payload))
        self.message.emit(mid, True)
        self._wake.set()
        return mid

    def _outbox_loop(self):
        while self.running:
            self._wake.wait(3)
            self._wake.clear()
            online = {p["id"]: p for p in self.peers() if p["online"]}
            for peer_id, mid, payload in self.store.q("SELECT peer,msg_id,payload FROM outbox"):
                p = online.get(peer_id)
                if not p:
                    continue
                try:
                    c, r = self._request(p, "POST", "/msg", payload.encode(), timeout=8)
                    r.read()
                    c.close()
                    if r.status != 200:
                        continue
                except OSError:
                    continue
                self.store.q("DELETE FROM outbox WHERE peer=? AND msg_id=?", (peer_id, mid))
                self._delivered(mid)

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
            self._upsert({"id": m["from"], "name": m.get("name"), "port": m.get("port") or 47801,
                          "plat": m.get("plat", "")}, ip)   # пришло сообщение — значит, отправитель в сети
        if self.store.q("SELECT 1 FROM messages WHERE id=?", (m["id"],), one=True):
            return                                  # повтор после обрыва — уже есть
        chat = ALL if m.get("to") == ALL else m["from"]
        f = m.get("file")
        self.store.q("INSERT INTO messages(id,chat,sender,sender_name,ts,text,file,mine,status,local,unread) "
                     "VALUES(?,?,?,?,?,?,?,0,?,NULL,1)",
                     (m["id"], chat, m["from"], m.get("name", "?"), int(m.get("ts") or now_ms()), m.get("text", ""),
                      json.dumps(f) if f else None, "received"))
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
                if p and p["online"]:
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
        r = self.store.q("SELECT id,chat,sender,sender_name,ts,text,file,mine,status,local FROM messages WHERE id=?",
                         (mid,), one=True)
        return self._row(r) if r else None

    @staticmethod
    def _row(r):
        return dict(id=r[0], chat=r[1], sender=r[2], sender_name=r[3], ts=r[4], text=r[5] or "",
                    file=json.loads(r[6]) if r[6] else None, mine=bool(r[7]), status=r[8], local=r[9])

    def history(self, chat, limit=300):
        rows = self.store.q("SELECT id,chat,sender,sender_name,ts,text,file,mine,status,local FROM messages "
                            "WHERE chat=? ORDER BY ts DESC LIMIT ?", (chat, limit))
        return [self._row(r) for r in reversed(rows)]

    def last_and_unread(self, chat):
        last = self.store.q("SELECT id,chat,sender,sender_name,ts,text,file,mine,status,local FROM messages "
                            "WHERE chat=? ORDER BY ts DESC LIMIT 1", (chat,), one=True)
        unread = self.store.q("SELECT COUNT(*) FROM messages WHERE chat=? AND unread=1", (chat,), one=True)[0]
        return (self._row(last) if last else None), unread

    def mark_read(self, chat):
        self.store.q("UPDATE messages SET unread=0 WHERE chat=? AND unread=1", (chat,))

    def queued_count(self):
        return self.store.q("SELECT COUNT(*) FROM outbox", one=True)[0]


# ======================================================================= настройки

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
    QWidget#msgs {{ background: {P['bg']}; }}
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


class Bubble(QFrame):
    def __init__(self, win: "ChatWindow", m: dict, show_name: bool):
        super().__init__()
        self.win = win
        self.m = m
        me = m["mine"]
        self.setObjectName("bubble_me" if me else "bubble_them")
        self.setSizePolicy(QSizePolicy.Maximum, QSizePolicy.Preferred)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(14, 8, 14, 7)
        lay.setSpacing(3)
        if show_name and not me:
            n = QLabel(m["sender_name"])
            n.setStyleSheet(f"color:{avatar_color(m['sender'])}; font-weight:700; font-size:13px")
            lay.addWidget(n)
        f = m["file"]
        if f:
            row = QHBoxLayout()
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
            lay.addLayout(row)
            self.bar = QProgressBar()
            self.bar.setFixedHeight(5)
            self.bar.setTextVisible(False)
            self.bar.hide()
            lay.addWidget(self.bar)
            self.fbtn = button("", "link")
            self.fbtn.setStyleSheet(f"color:{'#FFFFFF' if me else P['accent']}; text-align:left; padding:0")
            self.fbtn.clicked.connect(self._file_action)
            lay.addWidget(self.fbtn)
        if m["text"]:
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
        self.meta.setObjectName("me_meta" if me else "them_meta")
        self.meta.setAlignment(Qt.AlignRight)
        lay.addWidget(self.meta)
        self.refresh(m)

    def refresh(self, m):
        self.m = m
        t = datetime.fromtimestamp(m["ts"] / 1000).strftime("%H:%M")
        st = ""
        if m["mine"]:
            s = m["status"] or ""
            if s == "queued":
                st = "  🕓 ждёт получателя"
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
            if m["mine"]:
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

    def progress(self, got, total):
        self.bar.show()
        self.bar.setRange(0, 1000)
        self.bar.setValue(int(got * 1000 / max(total, 1)))
        self.finfo.setText(f"{human(got)} из {human(total)}")
        self.fbtn.setText("Скачивается…")

    def _file_action(self):
        local = Path(self.m["local"]) if self.m["local"] else None
        if local and local.exists():
            (show_in_folder if self.m["mine"] else open_local)(local)
        elif not self.m["mine"]:
            self.win.node.download(self.m["id"])
            self.fbtn.setText("Жду отправителя…")


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
        self.chats = QListWidget()
        self.chats.setObjectName("chats")
        self.chats.currentItemChanged.connect(self._pick)
        sl.addWidget(self.chats, 1)
        self.net_lbl = label("", "small", wrap=True)
        self.net_lbl.setContentsMargins(16, 4, 12, 0)
        sl.addWidget(self.net_lbl)
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
        self.msgs = QWidget()
        self.msgs.setObjectName("msgs")
        self.ml = QVBoxLayout(self.msgs)
        self.ml.setContentsMargins(16, 12, 16, 12)
        self.ml.setSpacing(6)
        self.ml.addStretch(1)
        self.scroll.setWidget(self.msgs)
        rl.addWidget(self.scroll, 1)

        comp = QFrame()
        comp.setObjectName("composer")
        cl = QHBoxLayout(comp)
        cl.setContentsMargins(12, 10, 12, 10)
        cl.setSpacing(8)
        att = button("", "icon", icon="attach", tip="Отправить файл (или перетащите файлы в окно)",
                     fn=self.pick_files)
        att.setIconSize(QSize(24, 24))
        cl.addWidget(att, 0, Qt.AlignBottom)
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
        self.net_lbl.setText(f"В сети: {online} из {len(peers)}" + (f" · в очереди: {q}" if q else "") +
                             f"\nКод организации: {'•' * min(len(self.cfg['org']), 8)}")
        self._update_head()

    def _peer_avatar(self, p):
        pm = avatar(p["name"], p["id"], 44)
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
            self.head_av.setPixmap(avatar(p["name"], p["id"], 38))
            self.head_title.setText(p["name"] + (f" · {p['dept']}" if p["dept"] else ""))
            if p["online"]:
                self.head_sub.setText("в сети" + (" · телефон" if p["plat"] == "android" else ""))
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
        self.node.send(self.chat, t)

    def pick_files(self):
        paths, _ = QFileDialog.getOpenFileNames(self, "Файлы для отправки", str(Path.home()))
        self.send_files([Path(p) for p in paths])

    def send_files(self, paths):
        for p in paths:
            if p.is_file():
                self.node.send(self.chat, "", p)

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
            QMessageBox.information(self, "RafChat", "Настройки сохранены. Имя и отдел увидят остальные через "
                                    "несколько секунд; код организации применится после перезапуска.")
            self.me_lbl.setText(self._me_text())

    def _me_text(self):
        return f"Вы: {self.cfg['name']}" + (f" · {self.cfg['dept']}" if self.cfg.get("dept") else "")

    def about(self):
        QMessageBox.about(self, "О программе RafChat",
                          f"<h2>RafChat {APP_VER}</h2><p>Чат и передача файлов по локальной сети организации — "
                          f"без сервера и интернета.</p><p>Автор: <b>{APP_AUTHOR}</b><br>"
                          f"<a href='mailto:{APP_EMAIL}'>{APP_EMAIL}</a><br>{APP_COPYRIGHT}. Все права защищены.</p>")


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
