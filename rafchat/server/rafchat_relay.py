#!/usr/bin/env python3
"""RafChat Relay — сервер-ретранслятор для работы RafChat через интернет (не из одной локальной сети).

«Почтовый ящик» для зашифрованных сообщений: устройства организации отправляют сюда сообщения для коллег,
которых нет в той же сети, и забирают свои. Всё содержимое зашифровано на устройствах (AES-256-GCM, ключ из
кода организации) — сервер не знает кода и прочитать переписку не может. Нужен только Python 3.8+.

    python3 rafchat_relay.py [--port 47888] [--data /var/lib/rafchat]

API (все запросы с заголовками X-Org: <хэш организации>, X-Node: <id устройства>):
  POST /r/hello  {"profile": blob}        → {"peers": [{"id", "profile", "last"}], "now"}
  GET  /r/poll?wait=25                   → {"items": [{"qid", "blob"}]}   (ждёт новых до wait секунд)
  POST /r/ack    {"qids": [...]}         → удалить доставленное
  POST /r/send   {"to": id, "blob": ...} → положить в ящик получателя
  PUT  /r/file?fid=…  (тело — зашифрованный файл, до 60 МБ);  GET /r/file?fid=…
Файлы хранятся 3 дня (RAFCHAT_FILE_DAYS), всего не больше 3 ГБ (RAFCHAT_MAX_STORE_GB); на диске всегда
остаётся ≥ 1 ГБ свободного места — при нехватке первыми удаляются самые старые файлы.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

VERSION = "0.4.0"
KEEP_SEC = 7 * 86400          # сколько хранить недоставленные сообщения
FILE_KEEP_SEC = float(os.environ.get("RAFCHAT_FILE_DAYS", 3)) * 86400     # сколько хранить файлы
MAX_STORE = int(float(os.environ.get("RAFCHAT_MAX_STORE_GB", 3)) * 1024 ** 3)  # предел всех файлов на диске
MIN_FREE = 1024 ** 3          # на диске VPS всегда остаётся не меньше 1 ГБ свободного места (для VPN и системы)
MAX_FILE = 60 * 1024 * 1024
MAX_JSON = 2 * 1024 * 1024
ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class State:
    def __init__(self, data: Path):
        self.data = data
        self.files = data / "files"
        self.files.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Condition()
        self.orgs: dict = {}
        try:
            self.orgs = json.loads((data / "state.json").read_text("utf-8"))
        except Exception:
            self.orgs = {}
        self._dirty = False
        threading.Thread(target=self._saver, daemon=True).start()
        threading.Thread(target=self._cleaner, daemon=True).start()

    def org(self, oid):
        return self.orgs.setdefault(oid, {"nodes": {}, "queues": {}})

    def touch(self):
        self._dirty = True

    def _saver(self):
        while True:
            time.sleep(2)
            if not self._dirty:
                continue
            with self.lock:
                raw = json.dumps(self.orgs, ensure_ascii=False)
                self._dirty = False
            tmp = self.data / "state.json.tmp"
            tmp.write_text(raw, "utf-8")
            tmp.replace(self.data / "state.json")

    def _cleaner(self):
        while True:
            time.sleep(600)
            now = time.time()
            with self.lock:
                for o in self.orgs.values():
                    for nid in list(o["queues"]):
                        o["queues"][nid] = [it for it in o["queues"][nid] if now - it["t"] < KEEP_SEC]
                        if not o["queues"][nid]:
                            del o["queues"][nid]
                    for nid in list(o["nodes"]):
                        if now - o["nodes"][nid].get("last", 0) > 60 * 86400:
                            del o["nodes"][nid]
                self.touch()
            self.trim_files()

    def trim_files(self, need: int = 0) -> bool:
        """Удалить устаревшие файлы, а если места мало — самые старые, пока не освободится need байт.
        Возвращает False, если места так и не хватает."""
        import shutil
        now = time.time()
        items = []
        for f in self.files.glob("*"):
            try:
                st = f.stat()
            except OSError:
                continue
            if now - st.st_mtime > FILE_KEEP_SEC or (f.name.startswith(".") and now - st.st_mtime > 3600):
                f.unlink(missing_ok=True)
                continue
            items.append((st.st_mtime, st.st_size, f))
        items.sort()
        total = sum(sz for _, sz, _ in items)

        def free():
            try:
                return shutil.disk_usage(self.files).free
            except OSError:
                return MIN_FREE + need
        while items and (total + need > MAX_STORE or free() - need < MIN_FREE):
            _, sz, f = items.pop(0)
            f.unlink(missing_ok=True)
            total -= sz
        return total + need <= MAX_STORE and free() - need >= MIN_FREE


def make_handler(st: State):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "RafChatRelay/" + VERSION

        def log_message(self, *a):
            pass

        def _reply(self, code, obj):
            b = json.dumps(obj, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(b)))
            self.end_headers()
            self.wfile.write(b)

        def _ids(self):
            oid, nid = self.headers.get("X-Org", ""), self.headers.get("X-Node", "")
            if not ID_RE.match(oid) or not ID_RE.match(nid):
                self._reply(400, {"error": "ids"})
                return None
            return oid, nid

        def _body(self, limit):
            n = int(self.headers.get("Content-Length") or 0)
            if n > limit:
                self._reply(413, {"error": "too_big"})
                return None
            return self.rfile.read(n) if n else b""

        def do_GET(self):
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            if u.path == "/":
                return self._reply(200, {"app": "RafChat Relay", "version": VERSION})
            ids = self._ids()
            if not ids:
                return
            oid, nid = ids
            if u.path == "/r/poll":
                wait = min(max(float(q.get("wait", 25)), 0), 50)
                end = time.time() + wait
                with st.lock:
                    o = st.org(oid)
                    o["nodes"].setdefault(nid, {})["last"] = time.time()
                    while not o["queues"].get(nid) and time.time() < end:
                        st.lock.wait(end - time.time())
                    items = [{"qid": it["qid"], "blob": it["blob"]} for it in o["queues"].get(nid, [])[:200]]
                    o["nodes"][nid]["last"] = time.time()
                    st.touch()
                return self._reply(200, {"items": items})
            if u.path == "/r/file":
                fid = q.get("fid", "")
                f = st.files / f"{oid}_{fid}"
                if not ID_RE.match(fid) or not f.is_file():
                    return self._reply(404, {"error": "not_found"})
                size = f.stat().st_size
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(size))
                self.end_headers()
                with open(f, "rb") as fh:
                    while True:
                        b = fh.read(256 * 1024)
                        if not b:
                            break
                        self.wfile.write(b)
                return
            self._reply(404, {"error": "not_found"})

        def do_PUT(self):
            u = urlparse(self.path)
            ids = self._ids()
            if not ids:
                return
            oid, _ = ids
            fid = parse_qs(u.query).get("fid", [""])[0]
            if u.path != "/r/file" or not ID_RE.match(fid):
                return self._reply(404, {"error": "not_found"})
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_FILE:
                return self._reply(413, {"error": "too_big"})
            if not st.trim_files(n):
                return self._reply(507, {"error": "no_space"})
            tmp = st.files / f".{oid}_{fid}.{uuid.uuid4().hex[:6]}"
            left = n
            with open(tmp, "wb") as fh:
                while left:
                    b = self.rfile.read(min(left, 256 * 1024))
                    if not b:
                        break
                    fh.write(b)
                    left -= len(b)
            if left:
                tmp.unlink(missing_ok=True)
                return self._reply(400, {"error": "incomplete"})
            tmp.replace(st.files / f"{oid}_{fid}")
            self._reply(200, {"ok": True})

        def do_POST(self):
            u = urlparse(self.path)
            ids = self._ids()
            if not ids:
                return
            oid, nid = ids
            raw = self._body(MAX_JSON)
            if raw is None:
                return
            try:
                d = json.loads(raw or b"{}")
            except ValueError:
                return self._reply(400, {"error": "bad_json"})
            now = time.time()
            with st.lock:
                o = st.org(oid)
                if u.path == "/r/hello":
                    node = o["nodes"].setdefault(nid, {})
                    node["last"] = now
                    if isinstance(d.get("profile"), str) and len(d["profile"]) < 4096:
                        node["profile"] = d["profile"]
                    peers = [{"id": k, "profile": v.get("profile", ""), "last": v.get("last", 0)}
                             for k, v in o["nodes"].items() if k != nid and v.get("profile")]
                    st.touch()
                    out = {"peers": peers, "now": now}
                elif u.path == "/r/send":
                    to = str(d.get("to", ""))
                    if not ID_RE.match(to) or not isinstance(d.get("blob"), str):
                        return self._reply(400, {"error": "bad"})
                    q = o["queues"].setdefault(to, [])
                    if len(q) > 5000:
                        return self._reply(429, {"error": "queue_full"})
                    q.append({"qid": uuid.uuid4().hex, "blob": d["blob"], "t": now})
                    st.touch()
                    st.lock.notify_all()
                    out = {"ok": True}
                elif u.path == "/r/ack":
                    qids = set(d.get("qids") or [])
                    o["queues"][nid] = [it for it in o["queues"].get(nid, []) if it["qid"] not in qids]
                    st.touch()
                    out = {"ok": True}
                else:
                    return self._reply(404, {"error": "not_found"})
            self._reply(200, out)

    return H


class TLSServer(ThreadingHTTPServer):
    """Тот же сервер, но с шифрованием TLS (рукопожатие — в потоке клиента, чтобы медленный клиент
    не задерживал остальных). Нужен для мобильного интернета: операторы вырезают незашифрованный HTTP."""
    ctx = None

    def finish_request(self, request, client_address):
        request.settimeout(30)
        try:
            request = self.ctx.wrap_socket(request, server_side=True)
        except (OSError, ValueError):
            return
        request.settimeout(None)
        super().finish_request(request, client_address)


def main():
    ap = argparse.ArgumentParser(description="RafChat Relay")
    ap.add_argument("--port", type=int, action="append",
                    help="порт (можно несколько раз: основной 47888 и запасные 443/80/8080 для мобильного интернета)")
    ap.add_argument("--tls-port", type=int, action="append", default=[],
                    help="порт с шифрованием TLS (для мобильного интернета)")
    ap.add_argument("--cert", default="", help="сертификат TLS (PEM)")
    ap.add_argument("--key", default="", help="ключ TLS (PEM)")
    ap.add_argument("--data", default=os.environ.get("RAFCHAT_RELAY_DATA", "/var/lib/rafchat"))
    a = ap.parse_args()
    ports = a.port or [int(p) for p in os.environ.get("RAFCHAT_RELAY_PORT", "47888").replace(",", " ").split()]
    st = State(Path(a.data))
    servers = []
    for port in ports:
        try:
            srv = ThreadingHTTPServer(("0.0.0.0", port), make_handler(st))
        except OSError as e:                     # порт занят (например, VPN на 443) — работаем на остальных
            print(f"порт {port} недоступен: {e}", flush=True)
            continue
        srv.daemon_threads = True
        servers.append((port, srv))
    if a.tls_port and a.cert and a.key:
        import ssl
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(a.cert, a.key)
        for port in a.tls_port:
            try:
                srv = TLSServer(("0.0.0.0", port), make_handler(st))
            except OSError as e:
                print(f"порт TLS {port} недоступен: {e}", flush=True)
                continue
            srv.ctx = ctx
            srv.daemon_threads = True
            servers.append((port, srv))
    if not servers:
        raise SystemExit("ни один порт не открылся")
    print(f"RafChat Relay {VERSION}: порты {', '.join(str(p) for p, _ in servers)}, данные {a.data}", flush=True)
    for _, srv in servers[1:]:
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    servers[0][1].serve_forever()


if __name__ == "__main__":
    main()
