"""Ресурс версии для RafChat.exe (Свойства файла → Подробно). Версия берётся из rafchat_pc.py (APP_VER).
Запуск: python make_version.py  → version_info.txt рядом; печатает версию."""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "rafchat_pc.py"), encoding="utf-8").read()
version = re.search(r'APP_VER = "([^"]+)"', src).group(1)
parts = [int(p) for p in (version.split(".") + ["0", "0", "0"])[:4]]
tup = "(%d, %d, %d, %d)" % tuple(parts)
info = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={tup}, prodvers={tup}, mask=0x3f, flags=0x0, OS=0x40004,
                    fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('041904B0', [
      StringStruct('CompanyName', 'Рафаил Шарапов'),
      StringStruct('LegalCopyright', '© 2026 Рафаил Шарапов · rafail@sharapov-cnc.ru'),
      StringStruct('FileDescription', 'RafChat — чат и файлы по локальной сети'),
      StringStruct('FileVersion', '{version}'),
      StringStruct('InternalName', 'RafChat'),
      StringStruct('OriginalFilename', 'RafChat.exe'),
      StringStruct('ProductName', 'RafChat'),
      StringStruct('ProductVersion', '{version}')])]),
    VarFileInfo([VarStruct('Translation', [0x0419, 1200])])
  ]
)
"""
with open(os.path.join(HERE, "version_info.txt"), "w", encoding="utf-8") as f:
    f.write(info)
print(version)
