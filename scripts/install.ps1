# EasyPass kurulumu (yönetici gerekmez). Tekrar çalıştırılabilir.
# Kullanım: powershell -ExecutionPolicy Bypass -File scripts\install.ps1 [-Uninstall]
# Not: dosya UTF-8 BOM ile kaydedilmeli (PowerShell 5.1 Türkçe karakterleri ancak öyle okur).
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'

$root     = Split-Path $PSScriptRoot -Parent
$dest     = Join-Path $env:LOCALAPPDATA 'EasyPass'
$regKey   = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.easypass.host'
$lnk      = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\EasyPass.lnk'
$manifest = Join-Path $dest 'com.easypass.host.json'
$hostExe  = Join-Path $dest 'EasyPass.Host.exe'

if (Get-Process EasyPass -ErrorAction SilentlyContinue) {
    throw 'EasyPass açık. Kaydedilmemiş değişiklik kaybolmasın diye önce uygulamayı kapatın, sonra tekrar çalıştırın.'
}
# Host durumsuzdur, kapatmak güvenli; eklenti sonraki istekte yeniden başlatır.
Get-Process EasyPass.Host -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 300

if ($Uninstall) {
    Remove-Item $regKey -Recurse -ErrorAction SilentlyContinue
    Remove-Item $lnk -ErrorAction SilentlyContinue
    Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host 'EasyPass kaldırıldı. Kasa dosyanız ve %APPDATA%\EasyPass ayarları silinmedi.'
    Write-Host 'Chrome eklentisini chrome://extensions sayfasından kaldırabilirsiniz.'
    return
}

function Test-Dotnet([string]$listArg, [string]$pattern) {
    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { return $false }
    return [bool](& dotnet $listArg | Select-String -Pattern $pattern)
}

# 1. .NET 10 Desktop Runtime
if (-not (Test-Dotnet '--list-runtimes' '^Microsoft\.WindowsDesktop\.App 10\.')) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw '.NET 10 Desktop Runtime yok ve winget bulunamadı. https://dotnet.microsoft.com/download/dotnet/10.0 adresinden kurup tekrar çalıştırın.'
    }
    Write-Host '.NET 10 Desktop Runtime kuruluyor (winget)...'
    winget install --id Microsoft.DotNet.DesktopRuntime.10 -e --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget başarısız (kod $LASTEXITCODE)." }
}

# 2. Derle (SDK ve kaynak varsa) ya da hazır publish\ klasörünü kullan
$publish = Join-Path $root 'publish'
$projects = 'src\EasyPass.App\EasyPass.App.csproj', 'src\EasyPass.Host\EasyPass.Host.csproj'
if ((Test-Path (Join-Path $root $projects[0])) -and (Test-Dotnet '--list-sdks' '^10\.')) {
    foreach ($p in $projects) {
        & dotnet publish (Join-Path $root $p) -c Release -r win-x64 --self-contained false -o $publish
        if ($LASTEXITCODE -ne 0) { throw "dotnet publish başarısız: $p" }
    }
}
if (-not (Test-Path (Join-Path $publish 'EasyPass.Host.exe'))) {
    throw "Derlenmiş dosyalar yok: $publish. .NET 10 SDK kurun ya da GitHub Actions çıktısını (publish\ klasörü içeren zip) kullanın."
}

# 3. Kopyala
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item (Join-Path $publish '*') $dest -Recurse -Force
Copy-Item (Join-Path $root 'extension') $dest -Recurse -Force

# 4. Native messaging host manifesti (BOM'suz UTF-8) + kayıt defteri
$json = @"
{
  "name": "com.easypass.host",
  "description": "EasyPass",
  "path": $($hostExe | ConvertTo-Json),
  "type": "stdio",
  "allowed_origins": ["chrome-extension://coikeomihlacdkjplpedddjmnkfobaon/"]
}
"@
[IO.File]::WriteAllText($manifest, $json)
New-Item -Path $regKey -Value $manifest -Force | Out-Null

# 5. Başlat menüsü kısayolu
$s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$s.TargetPath = Join-Path $dest 'EasyPass.exe'
$s.WorkingDirectory = $dest
$s.Save()

Write-Host ''
Write-Host "EasyPass kuruldu: $dest"
Write-Host 'Chrome eklentisini yükleyin (yalnız ilk kurulumda):'
Write-Host '  1. Chrome''da chrome://extensions sayfasını açın'
Write-Host '  2. Sağ üstte "Geliştirici modu"nu açın'
Write-Host '  3. "Paketlenmemiş öğe yükle" düğmesine basıp şu klasörü seçin:'
Write-Host "     $(Join-Path $dest 'extension')"
Write-Host 'Sonra Başlat menüsünden EasyPass''i açın.'
