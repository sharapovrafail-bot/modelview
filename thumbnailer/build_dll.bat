@echo off
rem Builds RafCADThumbs.dll (x64) with Visual Studio Build Tools.
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -all -products * -property installationPath`) do set "VS=%%i"
if not defined VS ( echo Visual Studio C++ Build Tools not found & exit /b 1 )
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
set "OUT=%~1"
if not defined OUT set "OUT=%~dp0bin"
if not exist "%OUT%" mkdir "%OUT%"
cl /nologo /O2 /MT /EHsc /W3 /utf-8 /DUNICODE /D_UNICODE /LD "%~dp0RafCADThumbs.cpp" ^
   /Fo"%OUT%\\" /Fe"%OUT%\RafCADThumbs.dll" ^
   /link /DEF:"%~dp0RafCADThumbs.def" ole32.lib user32.lib gdi32.lib || exit /b 1
del "%OUT%\*.obj" "%OUT%\*.exp" "%OUT%\*.lib" 2>nul
echo OK: %OUT%\RafCADThumbs.dll
