@echo off
rem Запуск ModelView из исходников (нужен Python 3 и pip install pywebview).
start "" pythonw "%~dp0modelview.py" %*
