; Установщик RafCAD View (Inno Setup 6). Собирается из build\build.bat.
; Ставится для всех пользователей (нужны права администратора): обработчик эскизов
; Проводника работает в системном процессе-суррогате, который видит только регистрацию в HKLM.

#define AppName "RafCAD View"
#ifndef AppVersion
  #define AppVersion "1.1"
#endif
#define AppExe "RafCADView.exe"
#define ProgId "RafCADView.Model"
#define ThumbClsid "{{8B1C7E52-3F4A-4D6B-9C2E-5A7D0F1B3E64}"
#define ThumbIface "{{e357fccd-a995-4576-b01f-234630154e96}"

[Setup]
AppId={{3C9A71E5-58B2-4F0D-A6E4-9B1D27C80F53}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Rafail Sharapov
AppComments=Быстрый просмотрщик STEP, IGES, STL и других 3D-файлов
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputDir=..
OutputBaseFilename=RafCADView-Setup-{#AppVersion}
SetupIconFile=rafcadview.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName} {#AppVersion}
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
VersionInfoCompany=Rafail Sharapov
VersionInfoDescription={#AppName} — установщик
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ChangesAssociations=yes
CloseApplications=yes
; закрывать только RafCADView.exe; DLL эскизов, занятая Проводником, меняется при перезагрузке
CloseApplicationsFilter=*.exe
RestartApplications=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Ярлыки:"
Name: "assoc"; Description: "Открывать файлы STEP, IGES, STL, OBJ… двойным кликом в RafCAD View"; GroupDescription: "Файлы:"

[Files]
Source: "{#DistDir}\*"; DestDir: "{app}"; Excludes: "RafCADThumbs.dll"; Flags: ignoreversion recursesubdirs createallsubdirs
; DLL эскизов может быть занята Проводником — тогда заменится после перезагрузки
Source: "{#DistDir}\RafCADThumbs.dll"; DestDir: "{app}"; Flags: ignoreversion restartreplace uninsrestartdelete

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; тип файла RafCAD View
Root: HKA; Subkey: "Software\Classes\{#ProgId}"; ValueType: string; ValueData: "3D-модель"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\{#ProgId}\DefaultIcon"; ValueType: string; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\{#ProgId}\shell\open\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; «Открыть с помощью»
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#AppName}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\shell\open\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .step
Root: HKA; Subkey: "Software\Classes\.step\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.step"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".step"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.step\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.step\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.step\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .stp
Root: HKA; Subkey: "Software\Classes\.stp\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.stp"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".stp"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.stp\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.stp\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.stp\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .iges
Root: HKA; Subkey: "Software\Classes\.iges\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.iges"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".iges"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.iges\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.iges\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.iges\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .igs
Root: HKA; Subkey: "Software\Classes\.igs\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.igs"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".igs"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.igs\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.igs\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.igs\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .brep
Root: HKA; Subkey: "Software\Classes\.brep\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.brep"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".brep"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.brep\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.brep\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.brep\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .brp
Root: HKA; Subkey: "Software\Classes\.brp\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.brp"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".brp"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.brp\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.brp\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.brp\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .stl
Root: HKA; Subkey: "Software\Classes\.stl\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.stl"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".stl"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.stl\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.stl\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.stl\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .obj
Root: HKA; Subkey: "Software\Classes\.obj\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.obj"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".obj"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.obj\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.obj\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.obj\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .ply
Root: HKA; Subkey: "Software\Classes\.ply\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.ply"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".ply"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.ply\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.ply\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.ply\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .3mf
Root: HKA; Subkey: "Software\Classes\.3mf\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.3mf"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".3mf"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.3mf\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.3mf\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.3mf\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .glb
Root: HKA; Subkey: "Software\Classes\.glb\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.glb"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".glb"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.glb\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.glb\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.glb\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""
; .gltf
Root: HKA; Subkey: "Software\Classes\.gltf\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.gltf"; ValueType: string; ValueData: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: assoc
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".gltf"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.gltf\shell\RafCADView"; ValueType: string; ValueData: "Открыть в RafCAD View"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.gltf\shell\RafCADView"; ValueType: string; ValueName: "Icon"; ValueData: "{app}\{#AppExe},0"
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.gltf\shell\RafCADView\command"; ValueType: string; ValueData: """{app}\{#AppExe}"" ""%1"""

; обработчик эскизов (миниатюры моделей в Проводнике)
Root: HKA; Subkey: "Software\Classes\CLSID\{#ThumbClsid}"; ValueType: string; ValueData: "RafCAD View Thumbnail Provider"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\CLSID\{#ThumbClsid}\InprocServer32"; ValueType: string; ValueData: "{app}\RafCADThumbs.dll"
Root: HKA; Subkey: "Software\Classes\CLSID\{#ThumbClsid}\InprocServer32"; ValueType: string; ValueName: "ThreadingModel"; ValueData: "Apartment"

Root: HKA; Subkey: "Software\Classes\.step\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.step\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.stp\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.stp\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.iges\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.iges\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.igs\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.igs\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.brep\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.brep\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.brp\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.brp\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.stl\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.stl\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.obj\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.obj\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.ply\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.ply\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.3mf\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.3mf\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.glb\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.glb\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\.gltf\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\SystemFileAssociations\.gltf\ShellEx\{#ThumbIface}"; ValueType: string; ValueData: "{#ThumbClsid}"; Flags: uninsdeletekey

[Run]
Filename: "{app}\{#AppExe}"; Description: "Запустить RafCAD View"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
// Программа раньше называлась ModelView: перед установкой тихо удаляем старую версию,
// чтобы не осталось двух программ и двух пунктов в меню Проводника.
const
  OldUninstKey = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{6E2F3B1A-7C4D-4E8B-9A51-0D3C2B7F8E41}_is1';

procedure RemoveOld(Root: Integer);
var
  S: String;
  Code: Integer;
begin
  if RegQueryStringValue(Root, OldUninstKey, 'UninstallString', S) then
    Exec(RemoveQuotes(S), '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  RemoveOld(HKLM);
  RemoveOld(HKCU);
end;
