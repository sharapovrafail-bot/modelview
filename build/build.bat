@echo off
chcp 65001 >nul
rem Сборка установщика ModelView-Setup-<версия>.exe
rem Требуется: Python 3 с пакетами  pip install pyinstaller pillow pywebview
rem            Visual Studio Build Tools (C++) — для ModelViewThumbs.dll
rem            Inno Setup 6         winget install JRSoftware.InnoSetup
rem Результат: ..\ModelView-Setup-<версия>.exe
setlocal
set "VERSION=1.2"
set "ROOT=%~dp0.."
set "WORK=%TEMP%\modelview-build"
set "DIST=%WORK%\dist"

python "%~dp0make_icon.py" || goto :err

rem 1) программа: папка с ModelView.exe (без распаковки при каждом запуске — стартует быстрее)
python -m PyInstaller --noconfirm --clean --onedir --windowed ^
  --name ModelView ^
  --icon "%~dp0modelview.ico" ^
  --add-data "%ROOT%\app;app" ^
  --distpath "%DIST%" ^
  --workpath "%WORK%\work" ^
  --specpath "%WORK%" ^
  "%ROOT%\modelview.py" || goto :err

rem 2) обработчик эскизов Проводника (C++), кладётся рядом с ModelView.exe
call "%ROOT%\thumbnailer\build_dll.bat" "%DIST%\ModelView" || goto :err

rem 3) установщик
set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" ( echo Не найден Inno Setup 6 & goto :err )
"%ISCC%" /Q /DAppVersion=%VERSION% "/DDistDir=%DIST%\ModelView" "%~dp0setup.iss" || goto :err

echo.
echo Готово: %ROOT%\ModelView-Setup-%VERSION%.exe
goto :eof
:err
echo Ошибка сборки
exit /b 1
