; EasyPass kurulumu: uygulama + Chrome yardımcı programı + Chrome eklentisi; yönetici yetkisi gerekmez (yalnız bu kullanıcı).
; Derleme (deponun kökünde publish\ hazırken; CI bunu yapar):  iscc installer\EasyPass.iss
; Chrome Web Store kimliğiyle (iscc /DWebStoreId=<kimlik> ...) Chrome bir sonraki açılışta "eklenti eklendi" diye sorar.
; Windows'ta Chrome bunu yalnız Web Store'daki eklentiler için yapar; kimlik yoksa kurulum sonunda eklentiler sayfası ve
; eklenti klasörü açılır (Geliştirici modu + klasörü sürükle-bırak).
; Not: dosya UTF-8 BOM ile kaydedilmeli (Türkçe/Rusça metinler).

#define AppName "EasyPass"
#ifndef AppVersion
  #define AppVersion "1.4.0"
#endif
; extension/manifest.json içindeki "key" → paketlenmemiş eklentinin sabit kimliği (install.ps1 ile aynı)
#define DevId "coikeomihlacdkjplpedddjmnkfobaon"
#define HostKey "Software\Google\Chrome\NativeMessagingHosts\com.easypass.host"

[Setup]
AppId={{8F1C2B6E-4E0A-4C55-9C1B-EA5E5A1F0B11}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=ishflow
DefaultDirName={localappdata}\EasyPass
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=EasyPass-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\EasyPass.exe
UninstallDisplayName={#AppName}
CloseApplications=yes
ShowLanguageDialog=auto

[Languages]
#ifdef WebStoreId
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"; InfoAfterFile: "chrome-store.tr.txt"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"; InfoAfterFile: "chrome-store.ru.txt"
#else
Name: "tr"; MessagesFile: "compiler:Languages\Turkish.isl"; InfoAfterFile: "chrome-manual.tr.txt"
Name: "ru"; MessagesFile: "compiler:Languages\Russian.isl"; InfoAfterFile: "chrome-manual.ru.txt"
#endif

[CustomMessages]
tr.RunApp=EasyPass'i başlat
ru.RunApp=Запустить EasyPass
tr.DesktopIcon=Masaüstüne kısayol koy
ru.DesktopIcon=Создать ярлык на рабочем столе
tr.OpenChrome=Chrome'da eklentiler sayfasını ve eklenti klasörünü aç
ru.OpenChrome=Открыть страницу расширений Chrome и папку расширения
tr.NeedRuntime=EasyPass için .NET 10 Desktop Runtime gerekiyor ve bu bilgisayarda yok.%n%nMicrosoft'tan indirilip kurulsun mu? (yaklaşık 60 MB, Windows yönetici onayı isteyebilir)
ru.NeedRuntime=Для EasyPass нужен .NET 10 Desktop Runtime, на этом компьютере его нет.%n%nСкачать и установить его с сайта Microsoft? (около 60 МБ, Windows может запросить права администратора)
tr.RuntimeMissing=.NET 10 Desktop Runtime kurulamadı. https://dotnet.microsoft.com/download/dotnet/10.0 adresinden kurup kurulumu yeniden çalıştırın.
ru.RuntimeMissing=Не удалось установить .NET 10 Desktop Runtime. Установите его с https://dotnet.microsoft.com/download/dotnet/10.0 и запустите установку снова.
tr.AppRunning=EasyPass açık. Kaydedilmemiş değişiklik kaybolmasın diye önce uygulamayı kapatın, sonra Tamam'a basın.
ru.AppRunning=EasyPass открыт. Закройте приложение, чтобы не потерять несохранённые изменения, затем нажмите OK.

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcon}"; Flags: unchecked

[Files]
Source: "..\publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs
; test kiti (node_modules, test sayfaları) Chrome'a gitmesin
Source: "..\extension\*"; DestDir: "{app}\extension"; Excludes: "\test"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{userprograms}\EasyPass"; Filename: "{app}\EasyPass.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\EasyPass"; Filename: "{app}\EasyPass.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
; Chrome yardımcı programı nerede bulur: bu anahtar → manifest (CurStepChanged yazar)
Root: HKCU; Subkey: "{#HostKey}"; ValueType: string; ValueName: ""; ValueData: "{app}\com.easypass.host.json"; Flags: uninsdeletekey
#ifdef WebStoreId
; Chrome'un "eklenti eklendi, etkinleştirilsin mi?" sorusu; kaldırınca anahtar silinir, Chrome eklentiyi de kaldırır
Root: HKCU; Subkey: "Software\Google\Chrome\Extensions\{#WebStoreId}"; ValueType: string; ValueName: "update_url"; ValueData: "https://clients2.google.com/service/update2/crx"; Flags: uninsdeletekey
#endif

[Run]
Filename: "{app}\EasyPass.exe"; Description: "{cm:RunApp}"; Flags: postinstall nowait skipifsilent
#ifndef WebStoreId
Filename: "{cmd}"; Parameters: "/c start """" chrome chrome://extensions/ & explorer.exe /select,""{app}\extension"""; Description: "{cm:OpenChrome}"; Flags: postinstall nowait skipifsilent runhidden
#endif

[UninstallDelete]
; com.easypass.host.json kurulumda yazıldı; kasa dosyası ve %APPDATA%\EasyPass ayarları silinmez
Type: filesandordirs; Name: "{app}"

[Code]
const
  RuntimeUrl = 'https://aka.ms/dotnet/10.0/windowsdesktop-runtime-win-x64.exe';
  RuntimeFile = 'windowsdesktop-runtime-win-x64.exe';

var
  DownloadPage: TDownloadWizardPage;

function HasDesktopRuntime10: Boolean;
var
  Found: TFindRec;
begin
  Result := FindFirst(ExpandConstant('{commonpf64}\dotnet\shared\Microsoft.WindowsDesktop.App\10.*'), Found);
  if Result then FindClose(Found);
end;

function IsRunning(const ExeName: String): Boolean;
var
  Locator, Wmi, Procs: Variant;
begin
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Wmi := Locator.ConnectServer('.', 'root\CIMV2');
    Procs := Wmi.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''' + ExeName + '''');
    Result := Procs.Count > 0;
  except
    Result := False;
  end;
end;

// Chrome'un başlattığı yardımcı program durumsuzdur; kapatmak güvenli, eklenti bir sonraki istekte yeniden başlatır.
procedure StopHost;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/f /im EasyPass.Host.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

// Uygulama açıkken dosyaları değişmesin: kullanıcı kapatana ya da vazgeçene kadar sor.
function AppClosed: Boolean;
begin
  Result := True;
  while IsRunning('EasyPass.exe') do
    if MsgBox(CustomMessage('AppRunning'), mbInformation, MB_OKCANCEL) = IDCANCEL then begin
      Result := False;
      Exit;
    end;
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), SetupMessage(msgPreparingDesc), nil);
end;

function InstallRuntime: Boolean;
var
  Code: Integer;
begin
  Result := False;
  if MsgBox(CustomMessage('NeedRuntime'), mbConfirmation, MB_YESNO) = IDNO then Exit;
  DownloadPage.Clear;
  DownloadPage.Add(RuntimeUrl, RuntimeFile, '');
  DownloadPage.Show;
  try
    try
      DownloadPage.Download;
      // ShellExec (CreateProcess değil): runtime kurucusu yönetici onayı isteyebilir
      ShellExec('', ExpandConstant('{tmp}\') + RuntimeFile, '/install /passive /norestart', '', SW_SHOW, ewWaitUntilTerminated, Code);
    except
      SuppressibleMsgBox(AddPeriod(GetExceptionMessage), mbCriticalError, MB_OK, IDOK);
    end;
  finally
    DownloadPage.Hide;
  end;
  Result := HasDesktopRuntime10;
  if not Result then MsgBox(CustomMessage('RuntimeMissing'), mbError, MB_OK);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = wpReady) and not HasDesktopRuntime10 then Result := InstallRuntime;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not AppClosed then Result := SetupMessage(msgSetupAborted);
  StopHost;
end;

// Göreli "path": Chrome Windows'ta yolu manifestin klasörüne göre çözer, böylece kullanıcı adında Türkçe harf olsa da JSON düz ASCII kalır.
procedure WriteHostManifest;
var
  Origins: String;
begin
  Origins := '"chrome-extension://{#DevId}/"';
#ifdef WebStoreId
  Origins := Origins + ', "chrome-extension://{#WebStoreId}/"';
#endif
  SaveStringToFile(ExpandConstant('{app}\com.easypass.host.json'),
    '{' + #13#10 +
    '  "name": "com.easypass.host",' + #13#10 +
    '  "description": "EasyPass",' + #13#10 +
    '  "path": "EasyPass.Host.exe",' + #13#10 +
    '  "type": "stdio",' + #13#10 +
    '  "allowed_origins": [' + Origins + ']' + #13#10 +
    '}' + #13#10, False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then WriteHostManifest;
end;

function InitializeUninstall: Boolean;
begin
  Result := AppClosed;
  if Result then StopHost;
end;
