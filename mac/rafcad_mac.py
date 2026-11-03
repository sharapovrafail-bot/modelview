"""RafCAD View для macOS — своё окно (WKWebView через pywebview), без браузера.

Файлы открываются двойным щелчком в Finder («Открыть с помощью» → RafCAD View):
при запуске — через argv (PyInstaller --argv-emulation), в уже открытой программе —
через событие macOS openFiles (новая вкладка).
"""
import base64
import json
import os
import sys
import threading
import time

HERE = getattr(sys, "_MEIPASS", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, HERE)
import server  # noqa: E402

server.APP_DIR = os.path.join(HERE, "app")
APP_NAME = "RafCAD View"
DATA_DIR = os.path.expanduser("~/Library/Application Support/RafCAD View")


def app_version():
    try:
        with open(os.path.join(server.APP_DIR, "version.json"), encoding="utf-8") as f:
            return json.load(f).get("version", "")
    except Exception:
        return ""


APP_TITLE = (APP_NAME + " " + app_version()).strip()
window_ref = {}


def open_in_window(path):
    """Файл из Finder в уже открытое окно — новой вкладкой."""
    win = window_ref.get("w")
    if not (path and os.path.isfile(path) and win):
        return
    fid = server.register_file(path)
    for _ in range(20):
        try:
            win.evaluate_js(f"window.openServerFile && window.openServerFile({fid})")
            return
        except Exception:
            time.sleep(0.5)


class Api:
    """Функции, которые интерфейс вызывает через window.pywebview.api."""
    _window = None

    def set_title(self, title):
        if self._window and title:
            self._window.title = title

    def toggle_fullscreen(self):
        if self._window:
            self._window.toggle_fullscreen()

    def save_file(self, name, b64):
        """Окно macOS «Сохранить» для экспорта (PDF, PNG, STL, OBJ). Возвращает путь или ''."""
        import webview
        ext = os.path.splitext(name)[1].lower().lstrip(".")
        res = self._window.create_file_dialog(webview.SAVE_DIALOG, save_filename=name)
        if not res:
            return ""
        path = res if isinstance(res, str) else res[0]
        if ext and not path.lower().endswith("." + ext):
            path += "." + ext
        with open(path, "wb") as f:
            f.write(base64.b64decode(b64))
        return path


def hook_open_files():
    """Двойной щелчок по файлу, когда RafCAD View уже открыт: macOS шлёт application:openFiles:."""
    try:
        import objc
        from webview.platforms import cocoa

        delegate = cocoa.BrowserView.AppDelegate

        def application_openFiles_(self, app, filenames):
            for p in filenames:
                threading.Thread(target=open_in_window, args=(str(p),), daemon=True).start()

        objc.classAddMethods(delegate, [objc.selector(application_openFiles_, selector=b"application:openFiles:", signature=b"v@:@@")])
    except Exception as e:  # noqa: BLE001
        print("openFiles hook:", e)


def main():
    import webview
    args = [a for a in sys.argv[1:] if a.strip() and not a.startswith("-psn")]
    path = os.path.abspath(args[0]) if args else ""
    server.initial_file = path if path and os.path.isfile(path) else None
    srv = server.make_server()
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    hook_open_files()
    title = APP_TITLE
    if server.initial_file:
        title = os.path.basename(server.initial_file) + " — " + APP_TITLE
    webview.settings["ALLOW_DOWNLOADS"] = True
    api = Api()
    win = webview.create_window(title, f"http://127.0.0.1:{port}/", js_api=api, width=1440, height=900,
                                min_size=(1000, 640), background_color="#0b1220", text_select=False)
    api._window = win
    window_ref["w"] = win
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        webview.start(private_mode=False, storage_path=os.path.join(DATA_DIR, "webview"))
    finally:
        srv.shutdown()


if __name__ == "__main__":
    main()
