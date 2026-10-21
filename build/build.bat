@echo off
chcp 65001 >nul
rem Сборка установщика RafCADView-Setup-<версия>.exe (версия — в файле VERSION)
rem Требуется: Python 3 с пакетами  pip install pyinstaller pillow pywebview
rem            Visual Studio Build Tools (C++) — для RafCADThumbs.dll
rem            Inno Setup 6         winget install JRSoftware.InnoSetup
rem Результат: ..\RafCADView-Setup-<версия>.exe
setlocal
set /p VERSION=<"%~dp0..\VERSION"
set "ROOT=%~dp0.."
set "WORK=%TEMP%\modelview-build"
set "DIST=%WORK%\dist"

python "%~dp0make_icon.py" || goto :err
python "%~dp0make_version.py" "%WORK%" || goto :err

rem 1) программа: папка с RafCADView.exe (без распаковки при каждом запуске — стартует быстрее)
python -m PyInstaller --noconfirm --clean --onedir --windowed ^
  --name RafCADView ^
  --version-file "%WORK%\version_info.txt" ^
  --icon "%~dp0rafcadview.ico" ^
  --add-data "%ROOT%\app;app" ^
  --distpath "%DIST%" ^
  --workpath "%WORK%\work" ^
  --specpath "%WORK%" ^
  "%ROOT%\modelview.py" || goto :err

rem 2) обработчик эскизов Проводника (C++), кладётся рядом с RafCADView.exe.
rem    Нет Visual Studio Build Tools — берём готовую DLL из установленной программы
rem    (исходник обработчика меняется редко)
call "%ROOT%\thumbnailer\build_dll.bat" "%DIST%\RafCADView"
if errorlevel 1 (
  if exist "%ProgramFiles%\RafCAD View\RafCADThumbs.dll" (
    echo Компилятор C++ не найден — беру RafCADThumbs.dll из "%ProgramFiles%\RafCAD View"
    copy /y "%ProgramFiles%\RafCAD View\RafCADThumbs.dll" "%DIST%\RafCADView\" >nul || goto :err
  ) else goto :err
)

rem 3) установщик
set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" ( echo Не найден Inno Setup 6 & goto :err )
"%ISCC%" /Q /DAppVersion=%VERSION% "/DDistDir=%DIST%\RafCADView" "%~dp0setup.iss" || goto :err

echo.
echo Готово: %ROOT%\RafCADView-Setup-%VERSION%.exe
goto :eof
:err
echo Ошибка сборки
exit /b 1
