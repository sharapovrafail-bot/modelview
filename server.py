"""Быстрый просмотрщик 3D/CAD файлов (STEP, IGES, BREP, STL, OBJ, PLY, 3MF, GLB).

Запуск:  pythonw server.py [путь_к_файлу]
Поднимает локальный HTTP-сервер (только 127.0.0.1) и открывает окно Edge/Chrome
в режиме приложения. Сервер сам завершается после закрытия окна.
"""
import http.server
import json
import mimetypes
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser

APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app")
PREFERRED_PORT = 47615
IDLE_TIMEOUT = 180      # сек без пинга -> выход (страница пингует раз в 5 с, в фоне реже)
BYE_GRACE = 4           # сек после закрытия окна, чтобы пережить перезагрузку страницы
STARTUP_TIMEOUT = 90    # сек на первое подключение окна

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("text/javascript", ".js")

initial_file = None
last_ping = time.time()
got_ping = False
bye_at = None
lock = threading.Lock()


def touch():
    global last_ping, got_ping, bye_at
    with lock:
        last_ping = time.time()
        got_ping = True
        bye_at = None


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

    def do_POST(self):
        global bye_at
        n = int(self.headers.get("Content-Length") or 0)
        if n:
            self.rfile.read(n)
        if self.path == "/api/bye":
            with lock:
                bye_at = time.time()
        self._send(204, b"")

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        p = url.path

        if p == "/api/ping":
            touch()
            return self._send(200, b"{}")

        if p == "/api/initial":
            touch()
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


def find_browser():
    candidates = []
    for env in ("PROGRAMFILES(X86)", "PROGRAMFILES", "LOCALAPPDATA"):
        base = os.environ.get(env)
        if base:
            candidates.append(os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"))
            candidates.append(os.path.join(base, "Google", "Chrome", "Application", "chrome.exe"))
    for c in candidates:
        if os.path.isfile(c):
            return c
    return shutil.which("msedge") or shutil.which("chrome")


def open_window(url):
    exe = find_browser()
    if not exe:
        webbrowser.open(url)
        return
    profile = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "FastCadViewer", "profile")
    os.makedirs(profile, exist_ok=True)
    subprocess.Popen([exe, f"--app={url}", f"--user-data-dir={profile}",
                      "--no-first-run", "--no-default-browser-check",
                      "--window-size=1400,900"],
                     creationflags=getattr(subprocess, "DETACHED_PROCESS", 0))


def watchdog(server):
    start = time.time()
    while True:
        time.sleep(1)
        now = time.time()
        with lock:
            if not got_ping and now - start > STARTUP_TIMEOUT:
                break
            if got_ping and now - last_ping > IDLE_TIMEOUT:
                break
            if bye_at and now - bye_at > BYE_GRACE:
                break
    server.shutdown()


def main():
    global initial_file
    args = [a for a in sys.argv[1:] if a.strip()]
    serve_only = "--serve" in args          # только сервер, без окна и автозакрытия
    args = [a for a in args if a != "--serve"]
    if args:
        initial_file = os.path.abspath(args[0].strip().strip('"'))
    server = make_server()
    port = server.server_address[1]
    if serve_only:
        print(f"http://127.0.0.1:{port}/", flush=True)
    else:
        threading.Thread(target=watchdog, args=(server,), daemon=True).start()
        open_window(f"http://127.0.0.1:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
