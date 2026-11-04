"""Имитатор телефона RafLink для отладки программы ПК без Android.

    python tools/mock_phone.py <папка-как-память-телефона> [--pin 123456]

Отвечает тем же API, что и приложение на телефоне (порт 47700).
"""
import argparse
import json
import os
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT_NAME = "/storage/emulated/0"


class H(BaseHTTPRequestHandler):
    root: Path = None
    pin = "123456"
    token = None

    def log_message(self, *a):
        pass

    def _json(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def _local(self, p):
        p = p or ROOT_NAME
        if not (p == ROOT_NAME or p.startswith(ROOT_NAME + "/")):
            return None
        rel = p[len(ROOT_NAME):].strip("/")
        f = (self.root / rel).resolve()
        return f if str(f).startswith(str(self.root.resolve())) else None

    def _q(self):
        u = urlparse(self.path)
        return u.path, {k: v[0] for k, v in parse_qs(u.query).items()}

    def _auth(self):
        if H.token and self.headers.get("X-Token") == H.token:
            return True
        self._json(401, {"error": "not_paired"})
        return False

    def do_GET(self):
        path, q = self._q()
        if path == "/api/hello":
            return self._json(200, {"app": "RafLink", "version": "mock", "name": "Xiaomi 11T Pro (имитатор)",
                                    "model": "2107113SG", "paired": bool(H.token)})
        if not self._auth():
            return
        if path == "/api/info":
            return self._json(200, {"name": "Xiaomi 11T Pro", "battery": 86, "charging": False,
                                    "free": 61 * 2**30, "total": 128 * 2**30, "files_access": True,
                                    "root": ROOT_NAME})
        f = self._local(q.get("path"))
        if f is None:
            return self._json(403, {"error": "outside"})
        if path == "/api/list":
            if not f.is_dir():
                return self._json(404, {"error": "not_found"})
            items = [{"name": c.name, "dir": c.is_dir(), "size": c.stat().st_size if c.is_file() else 0,
                      "mtime": int(c.stat().st_mtime)} for c in f.iterdir() if not c.name.startswith(".")]
            return self._json(200, {"path": q.get("path") or ROOT_NAME, "items": items})
        if path in ("/api/file", "/api/thumb"):
            if not f.is_file():
                return self._json(404, {"error": "not_found"})
            data = f.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        path, q = self._q()
        n = int(self.headers.get("Content-Length") or 0)
        if path == "/api/pair":
            body = json.loads(self.rfile.read(n) or b"{}")
            if body.get("pin") != H.pin:
                return self._json(403, {"error": "wrong_pin"})
            H.token = secrets.token_hex(16)
            print("сопряжено с", body.get("pc_name"))
            return self._json(200, {"token": H.token, "name": "Xiaomi 11T Pro (имитатор)", "model": "2107113SG"})
        if not self._auth():
            return
        if path == "/api/upload":
            d = self.root / "Download" / "RafLink"
            d.mkdir(parents=True, exist_ok=True)
            name = os.path.basename(q.get("name", "file"))
            (d / name).write_bytes(self.rfile.read(n))
            print("получен файл", name)
            return self._json(200, {"name": name})
        self._json(404, {"error": "not_found"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--pin", default="123456")
    ap.add_argument("--port", type=int, default=47700)
    a = ap.parse_args()
    H.root = Path(a.root)
    H.pin = a.pin
    print(f"имитатор телефона: порт {a.port}, код {a.pin}, память {H.root}")
    ThreadingHTTPServer(("0.0.0.0", a.port), H).serve_forever()


if __name__ == "__main__":
    main()
