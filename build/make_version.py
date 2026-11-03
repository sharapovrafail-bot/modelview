"""Версия RafCAD View из файла VERSION (в корне проекта) ->
  app/version.json            — интерфейс показывает её в логотипе и заголовке окна
  <out>/version_info.txt      — ресурс версии для exe (Свойства файла → Подробно)
Запуск: python make_version.py <папка для version_info.txt>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
NAME = "RafCAD View"


def main():
    version = open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()
    parts = [int(p) for p in (version.split(".") + ["0", "0", "0"])[:4]]
    with open(os.path.join(ROOT, "app", "version.json"), "w", encoding="utf-8") as f:
        json.dump({"name": NAME, "version": version}, f, ensure_ascii=False)
    out = sys.argv[1] if len(sys.argv) > 1 else HERE
    os.makedirs(out, exist_ok=True)
    tup = "(%d, %d, %d, %d)" % tuple(parts)
    info = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={tup}, prodvers={tup}, mask=0x3f, flags=0x0, OS=0x40004,
                    fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('041904B0', [
      StringStruct('CompanyName', 'Рафаил Шарапов'),
      StringStruct('LegalCopyright', '© 2026 Рафаил Шарапов · rafail@sharapov-cnc.ru'),
      StringStruct('FileDescription', '{NAME} — просмотрщик STEP, IGES, STL'),
      StringStruct('FileVersion', '{version}'),
      StringStruct('InternalName', 'RafCADView'),
      StringStruct('OriginalFilename', 'RafCADView.exe'),
      StringStruct('ProductName', '{NAME}'),
      StringStruct('ProductVersion', '{version}')])]),
    VarFileInfo([VarStruct('Translation', [0x0419, 1200])])
  ]
)
"""
    with open(os.path.join(out, "version_info.txt"), "w", encoding="utf-8") as f:
        f.write(info)
    print(version)


if __name__ == "__main__":
    main()
