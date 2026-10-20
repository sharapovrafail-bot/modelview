@echo off
chcp 65001 >nul
rem Добавляет пункт "Открыть в ModelView" в контекстное меню файлов 3D-моделей
rem (только для текущего пользователя, права администратора не нужны).
rem Стандартная программа для этих файлов НЕ меняется.
set "SRV=%~dp0server.py"
for %%E in (.step .stp .iges .igs .brep .brp .stl .obj .ply .3mf .glb .gltf) do (
  reg add "HKCU\Software\Classes\SystemFileAssociations\%%E\shell\ModelView" /ve /d "Открыть в ModelView" /f >nul
  reg add "HKCU\Software\Classes\SystemFileAssociations\%%E\shell\ModelView\command" /ve /d "pythonw.exe \"%SRV%\" \"%%1\"" /f >nul
)
echo Готово: в меню правой кнопки мыши для STEP/STL/... появился пункт "Открыть в ModelView".
pause
