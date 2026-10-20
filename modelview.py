"""ModelView — настольное приложение (собственное окно на WebView2, без браузера).

Запуск:  ModelView.exe [путь_к_файлу]
Интерфейс отдаётся встроенным сервером из server.py (только 127.0.0.1) и
показывается в окне WebView2 — том же движке, что использует Windows для
своих приложений. Ни Edge, ни профилей браузера, ни входа в аккаунт.

Одно окно на пользователя: повторный запуск (двойной клик по другому файлу)
передаёт файл уже открытому окну — он открывается там новой вкладкой.
"""
import ctypes
import ctypes.wintypes
import json
import os
import secrets
import socket
import socketserver
import sys
import threading
import time

import server

DATA_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "ModelView")
INSTANCE_FILE = os.path.join(DATA_DIR, "instance.json")
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32


# ---------------------------------------------------------------------------
# Один экземпляр: первый запуск держит управляющий порт, остальные передают ему файл
# ---------------------------------------------------------------------------
class InstanceLock:
    """Именованный мьютекс сессии: запуски по одному решают, кто главное окно."""

    def __enter__(self):
        self.h = kernel32.CreateMutexW(None, False, "Local\\ModelView.SingleInstance")
        if self.h:
            kernel32.WaitForSingleObject(self.h, 15000)
        return self

    def __exit__(self, *exc):
        if self.h:
            kernel32.ReleaseMutex(self.h)
            kernel32.CloseHandle(self.h)


def forward_to_running(path):
    """Пробует отдать файл уже запущенному окну. True — передано, этот процесс не нужен."""
    try:
        with open(INSTANCE_FILE, encoding="utf-8") as f:
            info = json.load(f)
        with socket.create_connection(("127.0.0.1", int(info["port"])), timeout=3) as s:
            user32.AllowSetForegroundWindow(int(info.get("pid", -1)))
            s.sendall(json.dumps({"token": info["token"], "path": path or ""}).encode() + b"\n")
            s.settimeout(5)
            return s.recv(8).startswith(b"OK")
    except Exception:
        return False


def bring_to_front():
    """Показывает окно этого процесса поверх остальных."""
    pid = os.getpid()
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)
    def cb(hwnd, _):
        p = ctypes.wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(p))
        if p.value == pid and user32.IsWindowVisible(hwnd) and user32.GetWindowTextLengthW(hwnd) > 0:
            found.append(hwnd)
        return True

    user32.EnumWindows(cb, 0)
    for hwnd in found[:1]:
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.SetForegroundWindow(hwnd)


def start_control_server(on_file):
    token = secrets.token_hex(16)

    class Handler(socketserver.StreamRequestHandler):
        def handle(self):
            try:
                msg = json.loads(self.rfile.readline(65536).decode("utf-8"))
                if msg.get("token") != token:
                    return
                self.wfile.write(b"OK")
                on_file(msg.get("path") or "")
            except Exception:
                pass

    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(INSTANCE_FILE, "w", encoding="utf-8") as f:
        json.dump({"port": srv.server_address[1], "pid": os.getpid(), "token": token}, f)
    return srv


def remove_instance_file():
    try:
        with open(INSTANCE_FILE, encoding="utf-8") as f:
            if json.load(f).get("pid") == os.getpid():
                os.remove(INSTANCE_FILE)
    except Exception:
        pass


def fail(text):
    ctypes.windll.user32.MessageBoxW(None, text, "ModelView", 0x10)
    sys.exit(1)


class Api:
    """Функции, которые интерфейс вызывает через window.pywebview.api."""
    _window = None

    def set_title(self, title):
        if self._window and title:
            self._window.title = title

    def toggle_fullscreen(self):
        if self._window:
            self._window.toggle_fullscreen()


def main():
    args = [a for a in sys.argv[1:] if a.strip()]
    if "--serve" in args:          # режим отладки: только сервер, открыть в любом браузере
        server.main()
        return
    if "--thumbs" in args:         # генератор эскизов для Проводника (запускает ModelViewThumbs.dll)
        import thumbs
        thumbs.run()
        return

    try:
        import webview
    except Exception as e:  # pragma: no cover
        fail(f"Не найден компонент окна (pywebview):\n{e}")

    path = os.path.abspath(args[0].strip().strip('"')) if args else ""

    lock = InstanceLock().__enter__()
    if forward_to_running(path):
        lock.__exit__()
        return
    server.initial_file = path or None

    srv = server.make_server()
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    window_ref = {}

    def on_file(p):
        # файл из другого запуска -> новая вкладка в этом окне
        win = window_ref.get("w")
        if p and os.path.isfile(p) and win:
            fid = server.register_file(p)
            for _ in range(20):
                try:
                    win.evaluate_js(f"window.openServerFile && window.openServerFile({fid})")
                    break
                except Exception:
                    time.sleep(0.5)
        bring_to_front()

    control = start_control_server(on_file)
    lock.__exit__()

    title = "ModelView"
    if server.initial_file:
        title = os.path.basename(server.initial_file) + " — ModelView"

    webview.settings["ALLOW_DOWNLOADS"] = True          # экспорт PNG / STL / OBJ
    webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = False
    api = Api()
    window = webview.create_window(
        title, f"http://127.0.0.1:{port}/", js_api=api,
        width=1440, height=900, min_size=(1000, 640),
        background_color="#0b1220", text_select=False, maximized=True,
    )

    api._window = window
    window_ref["w"] = window
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        webview.start(gui="edgechromium", private_mode=False,
                      storage_path=os.path.join(DATA_DIR, "webview"))
    except Exception as e:
        fail("Не удалось открыть окно программы.\n"
             "Возможно, в системе нет компонента Microsoft Edge WebView2 Runtime "
             "(в Windows 10/11 он обычно установлен).\n"
             "Скачать: https://developer.microsoft.com/microsoft-edge/webview2/\n\n" + str(e))
    finally:
        remove_instance_file()
        control.shutdown()
        srv.shutdown()


if __name__ == "__main__":
    main()
