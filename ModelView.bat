@echo off
rem Запуск просмотрщика ModelView. Можно передать путь к файлу.
start "" pythonw "%~dp0server.py" %*
