"""Встроенный HTTP-сервер ModelView: отдаёт интерфейс (app/) и открываемый файл.

Используется окном программы (modelview.py). Отдельно, для отладки в браузере:
    python server.py [путь_к_файлу]   -> печатает адрес http://127.0.0.1:порт/
Слушает только 127.0.0.1.
"""
import http.server
import json
import mimetypes
import os
import shutil
import sys
import urllib.parse

# в собранной программе (PyInstaller) файлы интерфейса лежат в sys._MEIPASS
BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(BASE_DIR, "app")
PREFERRED_PORT = 47615

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")

initial_file = None


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path, ctype, extra=None):
        size = os.path.getsize(path)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(size))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        with open(path, "rb") as f:
            shutil.copyfileobj(f, self.wfile, 1 << 20)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        p = url.path

        if p == "/api/initial":
            info = {}
            if initial_file and os.path.isfile(initial_file):
                info = {"name": os.path.basename(initial_file),
                        "size": os.path.getsize(initial_file)}
            return self._send(200, json.dumps(info).encode())

        if p == "/api/file":
            if not (initial_file and os.path.isfile(initial_file)):
                return self._send(404, b"{}")
            return self._send_file(initial_file, "application/octet-stream")

        # статика из app/
        rel = urllib.parse.unquote(p).lstrip("/") or "index.html"
        full = os.path.realpath(os.path.join(APP_DIR, rel))
        if not full.startswith(os.path.realpath(APP_DIR) + os.sep) or not os.path.isfile(full):
            return self._send(404, b"not found", "text/plain")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        cache = {"Cache-Control": "max-age=86400"} if "/lib/" in full.replace("\\", "/") else {"Cache-Control": "no-cache"}
        self._send_file(full, ctype, cache)


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False


def make_server():
    for port in (PREFERRED_PORT, 0):
        try:
            return Server(("127.0.0.1", port), Handler)
        except OSError:
            continue
    raise RuntimeError("Не удалось открыть порт")


def main():
    global initial_file
    args = [a for a in sys.argv[1:] if a.strip() and a != "--serve"]
    if args:
        initial_file = os.path.abspath(args[0].strip().strip('"'))
    server = make_server()
    print(f"http://127.0.0.1:{server.server_address[1]}/", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
