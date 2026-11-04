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

VERSION = "0.1.0"
KEEP_SEC = 7 * 86400          # сколько хранить недоставленное и файлы
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
            time.sleep(3600)
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
            for f in self.files.glob("*"):
                if now - f.stat().st_mtime > KEEP_SEC:
                    f.unlink(missing_ok=True)


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


def main():
    ap = argparse.ArgumentParser(description="RafChat Relay")
    ap.add_argument("--port", type=int, default=int(os.environ.get("RAFCHAT_RELAY_PORT", 47888)))
    ap.add_argument("--data", default=os.environ.get("RAFCHAT_RELAY_DATA", "/var/lib/rafchat"))
    a = ap.parse_args()
    st = State(Path(a.data))
    srv = ThreadingHTTPServer(("0.0.0.0", a.port), make_handler(st))
    srv.daemon_threads = True
    print(f"RafChat Relay {VERSION}: порт {a.port}, данные {a.data}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
