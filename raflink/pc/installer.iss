; Установщик RafLink для Windows (Inno Setup 6). Собирается на GitHub Actions.
; Ставится для текущего пользователя, права администратора не нужны.
#define AppVer GetEnv("RAFLINK_VER")

[Setup]
AppId={{6E2B9C14-3F7A-4D58-9B21-7A3C5E0D4F18}
AppName=RafLink
AppVersion={#AppVer}
AppVerName=RafLink {#AppVer}
AppPublisher=Рафаил Шарапов
DefaultDirName={localappdata}\Programs\RafLink
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\out
OutputBaseFilename=RafLink-Setup-{#AppVer}
SetupIconFile=raflink.ico
UninstallDisplayIcon={app}\RafLink.exe
UninstallDisplayName=RafLink — телефон и ПК
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Ярлык на рабочем столе"
Name: "autostart"; Description: "Запускать вместе с Windows (в фоне, значок у часов)"

[Files]
Source: "dist\RafLink\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{autoprograms}\RafLink"; Filename: "{app}\RafLink.exe"
Name: "{autodesktop}\RafLink"; Filename: "{app}\RafLink.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "RafLink"; ValueData: """{app}\RafLink.exe"" --tray"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\RafLink.exe"; Description: "Запустить RafLink"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM RafLink.exe"; Flags: runhidden; RunOnceId: "StopRafLink"

[Code]
// Перед установкой закрываем запущенный RafLink (в т.ч. старую версию, работающую у часов).
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  R: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM RafLink.exe', '', SW_HIDE, ewWaitUntilTerminated, R);
  Sleep(800);
  Result := '';
end;
