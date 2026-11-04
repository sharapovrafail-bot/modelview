"""Имитатор телефона RafLink для отладки программы ПК без Android.

    python tools/mock_phone.py <папка-как-память-телефона> [--pin 123456]

Отвечает тем же API, что и приложение на телефоне (порт 47700).
"""
import argparse
import hashlib
import io
import json
import os
import secrets
import ssl
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT_NAME = "/storage/emulated/0"


class H(BaseHTTPRequestHandler):
    root: Path = None
    pin = "123456"
    token = None
    fp = None
    tls_port = 0
    tls_only = False
    cut = 0                  # сколько раз оборвать передачу на середине (проверка докачки)
    clip_seq = 0
    clip_text = ""
    screen = {"running": False, "asked": 0.0}
    inputs = []

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

    def _outbox(self):
        d = self.root.parent / "outbox"
        d.mkdir(exist_ok=True)
        return sorted(f for f in d.iterdir() if "__" in f.name)

    @property
    def secure(self):
        return isinstance(self.connection, ssl.SSLSocket)

    def _auth(self):
        if H.token and self.headers.get("X-Token") == H.token:
            if not self.secure and H.tls_only:
                self._json(403, {"error": "tls_required"})
                return False
            if self.secure:
                H.tls_only = True
            return True
        self._json(401, {"error": "not_paired"})
        return False

    def _send_file(self, f):
        data = f.read_bytes()
        m = __import__("re").match(r"bytes=(\d+)-", self.headers.get("Range") or "")
        start = int(m.group(1)) if m else 0
        if 0 < start < len(data):
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{len(data) - 1}/{len(data)}")
            body = data[start:]
        else:
            self.send_response(200)
            body = data
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if H.cut and len(body) > 300_000:
            H.cut -= 1
            self.wfile.write(body[: len(body) // 2])
            self.wfile.flush()
            print("ОБРЫВ при скачивании", f.name, "на", len(body) // 2)
            self.connection.shutdown(2)
            return
        self.wfile.write(body)

    def _frame(self, n):
        from PIL import Image, ImageDraw
        im = Image.new("RGB", (360, 780), (242, 242, 247))
        d = ImageDraw.Draw(im)
        d.rectangle((20, 60, 340, 160), fill=(255, 255, 255))
        d.text((40, 90), f"RafLink · кадр {n}", fill=(0, 0, 0))
        d.rectangle((20, 190, 340, 250), fill=(0, 122, 255))
        for i, ev in enumerate(H.inputs[-8:]):
            d.text((30, 280 + i * 24), str(ev)[:52], fill=(60, 60, 60))
        b = io.BytesIO()
        im.save(b, "JPEG", quality=70)
        return b.getvalue()

    def do_GET(self):
        path, q = self._q()
        if path == "/api/hello":
            o = {"app": "RafLink", "version": "mock", "name": "Xiaomi 11T Pro (имитатор)",
                 "model": "2107113SG", "paired": bool(H.token), "secure": self.secure}
            if H.fp:
                o.update(tls_port=H.tls_port, fp=H.fp)
            return self._json(200, o)
        if not self._auth():
            return
        if path == "/api/info":
            return self._json(200, {"name": "Xiaomi 11T Pro", "battery": 86, "charging": False,
                                    "free": 61 * 2**30, "total": 128 * 2**30, "files_access": True,
                                    "root": ROOT_NAME, "outbox": len(self._outbox()), "clip_seq": H.clip_seq,
                                    "secure": self.secure})
        if path == "/api/clip":
            return self._json(200, {"seq": H.clip_seq, "text": H.clip_text})
        if path == "/api/upload/status":
            part = self.root / "Download" / "RafLink" / f".rl_{q.get('id')}.part"
            return self._json(200, {"have": part.stat().st_size if part.exists() else 0})
        if path == "/api/screen/state":
            if H.screen["asked"] and time.time() - H.screen["asked"] > 1.5:
                H.screen["running"] = True
            return self._json(200, {"running": H.screen["running"], "width": 360, "height": 780, "control": True})
        if path == "/api/screen/stream":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=rlframe")
            self.end_headers()
            n = 0
            try:
                while H.screen["running"]:
                    n += 1
                    fr = self._frame(n)
                    self.wfile.write(b"--rlframe\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(fr))
                    self.wfile.write(fr + b"\r\n")
                    self.wfile.flush()
                    time.sleep(0.3)
            except OSError:
                pass
            return
        if path in ("/api/albums", "/api/media"):
            media = sorted((f for f in self.root.rglob("*")
                            if f.suffix.lower() in (".jpg", ".png", ".mp4") and "outbox" not in f.parts),
                           key=lambda f: -f.stat().st_mtime)
            def item(f):
                return {"path": ROOT_NAME + "/" + str(f.relative_to(self.root)), "name": f.name,
                        "size": f.stat().st_size, "mtime": int(f.stat().st_mtime), "dir": False}
            if path == "/api/media":
                alb = q.get("album", "all")
                return self._json(200, {"items": [item(f) for f in media if alb == "all" or f.parent.name == alb]})
            albums = {}
            for f in media:
                a = albums.setdefault(f.parent.name, {"id": f.parent.name, "name": f.parent.name, "count": 0,
                                                      "cover": item(f)["path"], "mtime": 0})
                a["count"] += 1
            return self._json(200, {"total": len(media), "albums": list(albums.values())})
        if path == "/api/outbox":
            return self._json(200, {"items": [{"id": f.name.split("__")[0], "name": f.name.split("__", 1)[1],
                                               "size": f.stat().st_size} for f in self._outbox()]})
        if path == "/api/outbox/file":
            f = next((f for f in self._outbox() if f.name.startswith(q.get("id", "?") + "__")), None)
            if not f:
                return self._json(404, {"error": "not_found"})
            return self._send_file(f)
        f = self._local(q.get("path"))
        if f is None:
            return self._json(403, {"error": "outside"})
        if path == "/api/list":
            if not f.is_dir():
                return self._json(404, {"error": "not_found"})
            items = [{"name": c.name, "dir": c.is_dir(), "size": c.stat().st_size if c.is_file() else 0,
                      "mtime": int(c.stat().st_mtime)} for c in f.iterdir() if not c.name.startswith(".")]
            return self._json(200, {"path": q.get("path") or ROOT_NAME, "items": items})
        if path == "/api/file":
            if not f.is_file():
                return self._json(404, {"error": "not_found"})
            return self._send_file(f)
        if path == "/api/thumb":
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
            H.tls_only = self.secure
            print("сопряжено с", body.get("pc_name"))
            return self._json(200, {"token": H.token, "name": "Xiaomi 11T Pro (имитатор)", "model": "2107113SG"})
        if not self._auth():
            return
        if path == "/api/clip":
            H.clip_text = json.loads(self.rfile.read(n) or b"{}").get("text", "")
            print("буфер телефона ←", H.clip_text[:60])
            return self._json(200, {"ok": True})
        if path == "/api/screen/request":
            self.rfile.read(n)
            H.screen["asked"] = time.time()
            return self._json(200, {"running": H.screen["running"], "control": True})
        if path == "/api/screen/stop":
            self.rfile.read(n)
            H.screen.update(running=False, asked=0.0)
            return self._json(200, {"ok": True})
        if path == "/api/input":
            ev = json.loads(self.rfile.read(n) or b"{}")
            H.inputs.append(ev)
            print("ввод:", ev)
            return self._json(200, {"ok": True})
        if path == "/api/outbox/done":
            for f in self._outbox():
                if f.name.startswith(q.get("id", "?") + "__"):
                    f.unlink()
                    print("ПК забрал", f.name)
            return self._json(200, {"ok": True})
        if path == "/api/upload" and q.get("id"):
            d = self.root / "Download" / "RafLink"
            d.mkdir(parents=True, exist_ok=True)
            part = d / f".rl_{q['id']}.part"
            have = part.stat().st_size if part.exists() else 0
            if int(q.get("offset", 0)) != have:
                return self._json(409, {"error": "offset", "have": have})
            if H.cut and n > 300_000:
                H.cut -= 1
                with open(part, "ab") as fo:
                    fo.write(self.rfile.read(n // 2))
                print("ОБРЫВ при отправке на", n // 2)
                self.connection.shutdown(2)
                return
            with open(part, "ab") as fo:
                fo.write(self.rfile.read(n))
            if part.stat().st_size < int(q["total"]):
                return self._json(200, {"have": part.stat().st_size, "partial": True})
            name = os.path.basename(q.get("name", "file"))
            part.replace(d / name)
            print("получен файл (по частям)", name)
            return self._json(200, {"name": name})
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
    ap.add_argument("--cert", help="PEM с сертификатом и ключом — включает шифрование на порту 47703")
    ap.add_argument("--cut", type=int, default=0, help="сколько раз оборвать передачу большого файла")
    ap.add_argument("--clip", help="через 6 с положить текст в буфер «для ПК»")
    a = ap.parse_args()
    H.root = Path(a.root)
    H.pin = a.pin
    H.cut = a.cut
    if a.clip:
        def later():
            time.sleep(6)
            H.clip_text, H.clip_seq = a.clip, H.clip_seq + 1
            print("телефон положил текст для ПК")
        threading.Thread(target=later, daemon=True).start()
    if a.cert:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(a.cert)
        srv = ThreadingHTTPServer(("0.0.0.0", 47703), H)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        pem = open(a.cert).read()
        cert_pem = pem[pem.index("-----BEGIN CERTIFICATE-----"):pem.index("-----END CERTIFICATE-----") + 25]
        der = ssl.PEM_cert_to_DER_cert(cert_pem)
        H.fp, H.tls_port = hashlib.sha256(der).hexdigest(), 47703
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"имитатор телефона: порт {a.port}, код {a.pin}, память {H.root}, TLS: {bool(H.fp)}")
    ThreadingHTTPServer(("0.0.0.0", a.port), H).serve_forever()


if __name__ == "__main__":
    main()
