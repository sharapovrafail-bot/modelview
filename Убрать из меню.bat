@echo off
chcp 65001 >nul
for %%E in (.step .stp .iges .igs .brep .brp .stl .obj .ply .3mf .glb .gltf) do (
  reg delete "HKCU\Software\Classes\SystemFileAssociations\%%E\shell\ModelView" /f >nul 2>&1
)
echo Пункт "Открыть в ModelView" удалён из контекстного меню.
pause
