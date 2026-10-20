@echo off
chcp 65001 >nul
rem Сборка ModelView.exe (один файл, Python для запуска не нужен).
rem Требуется: Python 3 с пакетами pyinstaller и pillow
rem   python -m pip install pyinstaller pillow
rem Результат: ..\ModelView.exe
setlocal
set "ROOT=%~dp0.."
set "WORK=%TEMP%\modelview-build"
python "%~dp0make_icon.py" || goto :err
python -m PyInstaller --noconfirm --clean --onefile --windowed ^
  --name ModelView ^
  --icon "%~dp0modelview.ico" ^
  --add-data "%ROOT%\app;app" ^
  --distpath "%ROOT%" ^
  --workpath "%WORK%" ^
  --specpath "%WORK%" ^
  "%ROOT%\server.py" || goto :err
echo.
echo Готово: %ROOT%\ModelView.exe
goto :eof
:err
echo Ошибка сборки
exit /b 1
