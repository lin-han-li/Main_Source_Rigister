#ifndef MyAppName
  #define MyAppName "OpenAI Register Full"
#endif
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0"
#endif
#ifndef MyAppPublisher
  #define MyAppPublisher "pengjianzhong"
#endif
#ifndef MyAppPublisherURL
  #define MyAppPublisherURL ""
#endif
#ifndef MyAppExeName
  #define MyAppExeName "Register_Full.exe"
#endif
#ifndef MyAppSourceExe
  #define MyAppSourceExe "Register_Full.exe"
#endif
#ifndef MyOutputDir
  #define MyOutputDir "."
#endif
#ifndef MyOutputBaseFilename
  #define MyOutputBaseFilename "Register_Full_Setup"
#endif

[Setup]
AppId={{3F46A3D5-9A67-4310-9B62-3E555A1C6147}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppPublisherURL}
AppSupportURL={#MyAppPublisherURL}
AppUpdatesURL={#MyAppPublisherURL}
DefaultDirName={localappdata}\OpenAI Register Full
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir={#MyOutputDir}
OutputBaseFilename={#MyOutputBaseFilename}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=assets\register_full_icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
VersionInfoVersion={#MyAppVersion}
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Installer
VersionInfoProductName={#MyAppName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional tasks:"; Flags: unchecked

[Files]
Source: "{#MyAppSourceExe}"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "config.example.json"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\accounts"; Flags: uninsneveruninstall
Name: "{app}\accounts\with_token"; Flags: uninsneveruninstall
Name: "{app}\accounts\without_token"; Flags: uninsneveruninstall
Name: "{app}\codex_tokens"; Flags: uninsneveruninstall

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Run {#MyAppName}"; WorkingDir: "{app}"; Flags: nowait postinstall skipifsilent
