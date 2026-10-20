"""Установка ModelView.exe для текущего пользователя (без прав администратора).

ModelView.exe --install    копирует программу в %LOCALAPPDATA%\\Programs\\ModelView,
                           создаёт ярлыки (рабочий стол, «Пуск») и пункт
                           «Открыть в ModelView» в меню правой кнопки для 3D-файлов.
ModelView.exe --uninstall  удаляет всё перечисленное.
Стандартная программа для файлов не меняется — ModelView лишь добавляется
в список «Открыть с помощью», откуда её можно выбрать по умолчанию.
"""
import ctypes
import os
import shutil
import subprocess
import sys
import winreg

EXTS = [".step", ".stp", ".iges", ".igs", ".brep", ".brp", ".stl", ".obj", ".ply", ".3mf", ".glb", ".gltf"]
TITLE = "ModelView"
LOCAL = os.environ.get("LOCALAPPDATA", os.path.expanduser("~"))
INSTALL_DIR = os.path.join(LOCAL, "Programs", "ModelView")
INSTALL_EXE = os.path.join(INSTALL_DIR, "ModelView.exe")
CLASSES = r"Software\Classes"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def message(text, error=False):
    flags = 0x10 if error else 0x40  # MB_ICONERROR / MB_ICONINFORMATION
    ctypes.windll.user32.MessageBoxW(None, text, TITLE, flags)


def _set(path, value, name=""):
    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, path) as k:
        winreg.SetValueEx(k, name, 0, winreg.REG_SZ, value)


def _delete_tree(path):
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, path, 0, winreg.KEY_ALL_ACCESS) as k:
            while True:
                try:
                    sub = winreg.EnumKey(k, 0)
                except OSError:
                    break
                _delete_tree(path + "\\" + sub)
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, path)
    except FileNotFoundError:
        pass


def _shortcut_paths():
    shell = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu", "Programs")
    desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    try:  # настоящая папка рабочего стола (может быть перенесена в OneDrive)
        buf = ctypes.create_unicode_buffer(260)
        if ctypes.windll.shell32.SHGetFolderPathW(None, 0x10, None, 0, buf) == 0:
            desktop = buf.value
    except Exception:
        pass
    return [os.path.join(desktop, "ModelView.lnk"), os.path.join(shell, "ModelView.lnk")]


def _make_shortcut(lnk, target):
    # пути передаём через переменные окружения — так не мешают пробелы и кириллица
    env = dict(os.environ, MV_LNK=lnk, MV_TARGET=target, MV_DIR=os.path.dirname(target))
    ps = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:MV_LNK);"
          "$s.TargetPath=$env:MV_TARGET;$s.WorkingDirectory=$env:MV_DIR;"
          "$s.IconLocation=$env:MV_TARGET+',0';$s.Description='Просмотрщик STEP, STL и других 3D-файлов';$s.Save()")
    subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                   env=env, creationflags=NO_WINDOW, check=True, timeout=30)


def install():
    if not getattr(sys, "frozen", False):
        message("Установка доступна только из собранного ModelView.exe.", error=True)
        return 1
    try:
        os.makedirs(INSTALL_DIR, exist_ok=True)
        src = os.path.abspath(sys.executable)
        if os.path.normcase(src) != os.path.normcase(INSTALL_EXE):
            shutil.copy2(src, INSTALL_EXE)

        cmd = f'"{INSTALL_EXE}" "%1"'
        # пункт в меню правой кнопки
        for ext in EXTS:
            base = rf"{CLASSES}\SystemFileAssociations\{ext}\shell\ModelView"
            _set(base, "Открыть в ModelView")
            _set(base, INSTALL_EXE + ",0", "Icon")
            _set(base + r"\command", cmd)
        # список «Открыть с помощью»
        app = rf"{CLASSES}\Applications\ModelView.exe"
        _set(app, "ModelView", "FriendlyAppName")
        _set(app + r"\DefaultIcon", INSTALL_EXE + ",0")
        _set(app + r"\shell\open\command", cmd)
        for ext in EXTS:
            _set(app + r"\SupportedTypes", "", ext)
            _set(rf"{CLASSES}\{ext}\OpenWithList\ModelView.exe", "")
        # «Установка и удаление программ»
        un = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ModelView"
        _set(un, "ModelView", "DisplayName")
        _set(un, INSTALL_EXE + ",0", "DisplayIcon")
        _set(un, f'"{INSTALL_EXE}" --uninstall', "UninstallString")
        _set(un, INSTALL_DIR, "InstallLocation")
        _set(un, "ModelView", "Publisher")

        for lnk in _shortcut_paths():
            os.makedirs(os.path.dirname(lnk), exist_ok=True)
            _make_shortcut(lnk, INSTALL_EXE)

        ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)  # обновить значки в Проводнике
    except Exception as e:
        message(f"Не удалось установить ModelView:\n{e}", error=True)
        return 1
    message("ModelView установлен.\n\n"
            "• Ярлыки — на рабочем столе и в меню «Пуск».\n"
            "• В меню правой кнопки у STEP/STL/… появился пункт «Открыть в ModelView».\n\n"
            "Чтобы открывать файлы двойным кликом: правая кнопка по файлу → "
            "«Открыть с помощью» → «Выбрать другое приложение» → ModelView → «Всегда».")
    return 0


def uninstall():
    for ext in EXTS:
        _delete_tree(rf"{CLASSES}\SystemFileAssociations\{ext}\shell\ModelView")
        _delete_tree(rf"{CLASSES}\{ext}\OpenWithList\ModelView.exe")
    _delete_tree(rf"{CLASSES}\Applications\ModelView.exe")
    _delete_tree(r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ModelView")
    for lnk in _shortcut_paths():
        try:
            os.remove(lnk)
        except OSError:
            pass
    ctypes.windll.shell32.SHChangeNotify(0x08000000, 0, None, None)
    if os.path.isdir(INSTALL_DIR):
        # запущенный exe не может удалить сам себя — удаляем папку чуть позже
        subprocess.Popen(f'cmd /c timeout /t 2 /nobreak >nul & rmdir /s /q "{INSTALL_DIR}"',
                         creationflags=NO_WINDOW, cwd=os.environ.get("TEMP", "C:\\"))
    message("ModelView удалён.")
    return 0
