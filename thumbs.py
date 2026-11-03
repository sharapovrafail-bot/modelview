"""Генератор эскизов для Проводника: RafCADView.exe --thumbs

Запускается обработчиком эскизов RafCADThumbs.dll при первом запросе и
сам завершается после простоя. Один экземпляр на пользователя (порт 47621).

Протокол (127.0.0.1:47621, little-endian):
  запрос:  b"MVT1" | расширение 8 байт ASCII | размер uint32 | длина uint64 | данные файла
  ответ:   длина uint32 | PNG  (длина 0 — эскиз сделать не удалось)
"""
import base64
import queue
import socket
import socketserver
import struct
import threading
import time
import uuid

import server

THUMB_PORT = 47621
IDLE_EXIT = 90                    # сек без запросов -> выход
MAX_BYTES = 300 * 1024 * 1024     # файлы крупнее не рендерим (эскиз был бы слишком долгим)
EXTS = {"step", "stp", "iges", "igs", "brep", "brp", "stl", "obj", "ply", "3mf", "glb", "gltf", "dxf", "dwg"}

tasks = queue.Queue()
last_activity = time.time()


def recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(min(n - len(buf), 1 << 20))
        if not chunk:
            raise ConnectionError("соединение закрыто")
        buf += chunk
    return bytes(buf)


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        global last_activity
        sock = self.request
        sock.settimeout(120)
        png = b""
        try:
            head = recv_exact(sock, 4 + 8 + 4 + 8)
            magic, ext, size, length = struct.unpack("<4s8sIQ", head)
            ext = ext.rstrip(b"\0").decode("ascii", "ignore").lower().lstrip(".")
            if magic != b"MVT1" or ext not in EXTS or length > MAX_BYTES:
                return
            data = recv_exact(sock, length)
            last_activity = time.time()
            done = threading.Event()
            box = {}
            tasks.put((ext, size, data, done, box))
            done.wait(110)
            png = box.get("png", b"")
        except Exception:
            png = b""
        finally:
            try:
                sock.sendall(struct.pack("<I", len(png)) + png)
            except Exception:
                pass
            last_activity = time.time()


class ThumbServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = False

    def server_bind(self):
        # не даём второму экземпляру занять тот же порт
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def run():
    import webview

    try:
        tcp = ThumbServer(("127.0.0.1", THUMB_PORT), Handler)
    except OSError:
        return  # генератор уже запущен
    http = server.make_server(port=0)
    port = http.server_address[1]
    threading.Thread(target=http.serve_forever, daemon=True).start()
    threading.Thread(target=tcp.serve_forever, daemon=True).start()

    window = webview.create_window("RafCAD View thumbnails", f"http://127.0.0.1:{port}/thumb.html",
                                   hidden=True, width=400, height=400)

    def worker():
        # ждём, пока страница загрузит three.js и OpenCascade
        for _ in range(300):
            try:
                if window.evaluate_js("window.thumbReady === true"):
                    break
            except Exception:
                pass
            time.sleep(0.1)
        while True:
            try:
                ext, size, data, done, box = tasks.get(timeout=1)
            except queue.Empty:
                if time.time() - last_activity > IDLE_EXIT:
                    break
                continue
            job = uuid.uuid4().hex
            server.jobs[job] = data
            try:
                # renderThumb возвращает Promise — pywebview ждёт его только с callback
                got = threading.Event()
                out = {}

                def on_result(res):
                    out["res"] = res
                    got.set()

                window.evaluate_js(f"window.renderThumb('{job}', '{ext}', {int(size)})", on_result)
                got.wait(100)
                res = out.get("res")
                if isinstance(res, str) and not res.startswith("ERROR:"):
                    box["png"] = base64.b64decode(res)
            except Exception:
                pass
            finally:
                server.jobs.pop(job, None)
                done.set()
        tcp.shutdown()
        http.shutdown()
        window.destroy()

    webview.start(worker, gui="edgechromium", private_mode=True)
