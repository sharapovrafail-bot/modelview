"""ModelView — настольное приложение (собственное окно на WebView2, без браузера).

Запуск:  ModelView.exe [путь_к_файлу]
Интерфейс отдаётся встроенным сервером из server.py (только 127.0.0.1) и
показывается в окне WebView2 — том же движке, что использует Windows для
своих приложений. Ни Edge, ни профилей браузера, ни входа в аккаунт.
"""
import ctypes
import os
import sys
import threading

import server

DATA_DIR = os.path.join(os.environ.get("LOCALAPPDATA", os.path.expanduser("~")), "ModelView")


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

    if args:
        server.initial_file = os.path.abspath(args[0].strip().strip('"'))

    srv = server.make_server()
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()

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
        srv.shutdown()


if __name__ == "__main__":
    main()
