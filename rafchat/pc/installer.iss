; Установщик RafChat для Windows (Inno Setup 6). Собирается на GitHub Actions.
; Нужны права администратора: добавить RafChat в исключения брандмауэра (иначе коллеги не смогут писать на этот ПК).
#define AppVer GetEnv("RAFCHAT_VER")

[Setup]
AppId={{9B4E2F61-1C7D-4A38-8E52-3D6F0A9B7C24}
AppName=RafChat
AppVersion={#AppVer}
AppVerName=RafChat {#AppVer}
AppPublisher=Рафаил Шарапов
AppContact=rafail@sharapov-cnc.ru
AppCopyright=© 2026 Рафаил Шарапов · rafail@sharapov-cnc.ru
AppComments=Чат и передача файлов по локальной сети организации
VersionInfoVersion={#AppVer}
VersionInfoProductName=RafChat
VersionInfoProductVersion={#AppVer}
VersionInfoCompany=Рафаил Шарапов
VersionInfoCopyright=© 2026 Рафаил Шарапов · rafail@sharapov-cnc.ru
VersionInfoDescription=RafChat — установщик
DefaultDirName={autopf}\RafChat
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputDir=..\..\out
OutputBaseFilename=RafChat-Setup-{#AppVer}
SetupIconFile=rafchat.ico
UninstallDisplayIcon={app}\RafChat.exe
UninstallDisplayName=RafChat {#AppVer}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=no

[Languages]
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Ярлык на рабочем столе"
Name: "autostart"; Description: "Запускать вместе с Windows (сообщения приходят, даже если окно закрыто)"

[Files]
Source: "dist\RafChat\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{autoprograms}\RafChat"; Filename: "{app}\RafChat.exe"
Name: "{autodesktop}\RafChat"; Filename: "{app}\RafChat.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "RafChat"; ValueData: """{app}\RafChat.exe"" --tray"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""RafChat"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""RafChat"" dir=in action=allow program=""{app}\RafChat.exe"" enable=yes profile=any"; Flags: runhidden
Filename: "{app}\RafChat.exe"; Description: "Запустить RafChat"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM RafChat.exe"; Flags: runhidden; RunOnceId: "StopRafChat"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""RafChat"""; Flags: runhidden; RunOnceId: "FwRafChat"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  R: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM RafChat.exe', '', SW_HIDE, ewWaitUntilTerminated, R);
  Sleep(800);
  Result := '';
end;
