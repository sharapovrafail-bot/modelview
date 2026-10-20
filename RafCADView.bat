@echo off
rem Запуск RafCAD View из исходников (нужен Python 3 и pip install pywebview).
start "" pythonw "%~dp0modelview.py" %*
