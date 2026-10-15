# EasyPass

Müşteri şifrelerini Chrome Password Manager yerine hafif bir Windows uygulamasında tutar.
Chrome eklentisi giriş alanının yanında bir arama kutusu açar: "Ahmet" yazın, kişiyi seçin;
kullanıcı adı ve şifre forma milisaniyeler içinde yazılır. Sitede şifre değişince eklenti
"EasyPass'te güncellensin mi?" diye sorar.

- Tüm şifreler tek dosyada: `vault.ezp` (AES-256-GCM, ana şifreyle şifreli).
- Dosyayı Google Drive ya da Yandex Disk klasörüne koyabilirsiniz; format sonrası yalnız ana şifreyle açılır.
- Uygulama kapalıyken de eklenti çalışır (Chrome yardımcı programı kendisi başlatır).
- Her kayıtta bir önceki sürüm `vault.ezp.bak` olarak kalır.

## Kurulum (iş bilgisayarı)

Yönetici yetkisi gerekmez. Kurulum betiği tekrar çalıştırılabilir; güncellemek için de aynı komutu çalıştırın.

1. Depoyu klonlayın ya da GitHub Actions çıktısını (`EasyPass` zip) indirip açın.
2. EasyPass açıksa kapatın. PowerShell'de klasörün içinde:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
   ```

Betik şunları yapar:
- .NET 10 Desktop Runtime yoksa `winget` ile kurar.
- .NET 10 SDK varsa projeyi derler; yoksa zip'teki hazır `publish\` klasörünü kullanır.
- Dosyaları `%LOCALAPPDATA%\EasyPass\` klasörüne kopyalar (eklenti dahil).
- Chrome bağlantısını kaydeder (`HKCU\Software\Google\Chrome\NativeMessagingHosts\com.easypass.host`).
- Başlat menüsüne "EasyPass" kısayolu ekler.

## Chrome eklentisini yükleme (bir kez)

1. Chrome'da `chrome://extensions` sayfasını açın.
2. Sağ üstte **Geliştirici modu**nu açın.
3. **Paketlenmemiş öğe yükle** düğmesine basın ve `%LOCALAPPDATA%\EasyPass\extension` klasörünü seçin
   (betik tam yolu sonunda yazar).
4. Eklenti simgesine tıklayın: "Bağlı" görünmeli.

## İlk kullanım

1. Başlat menüsünden **EasyPass**'i açın.
2. **Yeni kasa oluştur**: konum olarak Google Drive ya da Yandex Disk klasörünü seçin, ana şifreyi iki kez girin.
3. **Yeni müşteri** ile kayıt ekleyin (Ad, Soyad, Ek bilgi 1–2, Kullanıcı adı, Şifre).
4. Sitede giriş alanına tıklayın, ismi yazın, kişiyi seçin. Eklentiyle yaptığınız yeni girişleri de
   eklenti "Kaydedilsin mi?" diye sorarak kasaya ekler.

> Ana şifreyi unutursanız kasa açılamaz; kurtarma yolu yoktur. Ana şifreyi güvenli bir yere yazın.

## Format sonrası ya da yeni bilgisayarda

1. Google Drive / Yandex Disk uygulamasını kurun, kasa klasörünün eşitlendiğini görün.
2. Yukarıdaki **Kurulum** ve **Chrome eklentisini yükleme** adımlarını yapın.
3. EasyPass'i açın → **Var olan kasayı aç** → `vault.ezp` dosyasını seçin → ana şifreyi girin.

## Kaldırma

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Uninstall
```

Program dosyalarını, kısayolu ve Chrome kaydını siler. Kasa dosyanız (`vault.ezp`) ve
`%APPDATA%\EasyPass` ayarları silinmez. Eklentiyi `chrome://extensions` sayfasından kaldırın.

## Sorun giderme

| Belirti | Çözüm |
|---|---|
| Eklenti "Bağlantı yok" diyor | `install.ps1`'i yeniden çalıştırın, Chrome'u tamamen kapatıp açın. |
| Eklenti "Kilitli" diyor | EasyPass'i açın ve ana şifreyi girin. "Kilitle" düğmesine basılınca da kilitlenir. |
| "Betik çalıştırma devre dışı" hatası | Komutu yukarıdaki gibi `-ExecutionPolicy Bypass` ile çalıştırın. |
| "EasyPass açık" hatası | Uygulamayı kapatıp betiği tekrar çalıştırın. |
| Windows SmartScreen uyarısı | İndirilen zip'e sağ tık → Özellikler → **Engellemeyi kaldır**, sonra açın. |
| Kasa açılmıyor / dosya bozuk | Aynı klasördeki `vault.ezp.bak` bir önceki sürümdür: kopyasını alıp `vault.ezp` adıyla açmayı deneyin. |
| Panel bazı sitelerde çıkmıyor | Çerçeve (iframe) içindeki giriş formları bu sürümde desteklenmiyor. |

## Geliştirme

- .NET 10 SDK: `dotnet test EasyPass.slnx` (Windows). Mac/Linux'ta WPF projesi
  `-p:EnableWindowsTargeting=true` ile derlenir ama çalışmaz; testler için
  `dotnet test tests/EasyPass.Tests` kullanın.
- Her push'ta GitHub Actions (`.github/workflows/build.yml`, windows-latest) derler, test eder ve
  `publish\` + `extension\` + `scripts\` içeren `EasyPass` zip'ini çıktı olarak yükler.
- Tasarım: `docs/superpowers/specs/2026-10-16-easypass-design.md`.
