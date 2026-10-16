# EasyPass

Müşteri şifrelerini Chrome Password Manager yerine hafif bir Windows uygulamasında tutar.
Chrome eklentisi giriş alanının yanında bir arama kutusu açar: "Ahmet" yazın, kişiyi seçin;
kullanıcı adı ve şifre forma milisaniyeler içinde yazılır. Sitede şifre değişince eklenti
"EasyPass'te güncellensin mi?" diye sorar.

- Tüm şifreler tek dosyada: `vault.ezp` (AES-256-GCM, ana şifreyle şifreli).
- Dosyayı Google Drive ya da Yandex Disk klasörüne koyabilirsiniz; format sonrası yalnız ana şifreyle açılır.
- Uygulama kapalıyken de eklenti çalışır (Chrome yardımcı programı kendisi başlatır).
- Her kayıtta bir önceki sürüm `vault.ezp.bak` olarak kalır.

## Kurulum dosyası (önerilen)

GitHub Actions çıktısındaki `EasyPass-Setup` zip'inden `EasyPass-Setup-<sürüm>.exe`'yi açın, "İleri" ile ilerleyin.
Yönetici yetkisi gerekmez; güncellemek için yeni sürümü aynı şekilde kurun. Kurulum:
- .NET 10 Desktop Runtime yoksa sorup Microsoft'tan indirir ve kurar.
- Uygulamayı ve eklentiyi `%LOCALAPPDATA%\EasyPass\` klasörüne kurar, Chrome bağlantısını kaydeder, Başlat menüsüne
  kısayol ekler; Windows "Uygulamalar" listesinden kaldırılabilir (kasa dosyası ve ayarlar silinmez).
- Sonunda Chrome'un eklentiler sayfasını ve eklenti klasörünü açar: **Geliştirici modu**nu açıp `extension`
  klasörünü sayfaya sürükleyin (bir kez).

Chrome'un "eklenti eklendi, etkinleştirilsin mi?" sorusu: Windows'ta Chrome bunu yalnız Chrome Web Store'daki
eklentiler için sorar. Eklenti Web Store'a (liste dışı da olur) yüklenince kurulumu kimliğiyle derleyin:
`iscc /DWebStoreId=<kimlik> installer\EasyPass.iss`; kurulum eklentiyi kaydeder, Chrome bir sonraki açılışta sorar.

Kurulum dosyasını yerelde derlemek: deponun kökünde `publish\` hazırken (CI çıktısındaki `EasyPass` zip'i ya da
`dotnet publish`) `iscc installer\EasyPass.iss` → `dist\EasyPass-Setup-<sürüm>.exe`.

## Kurulum betiği (geliştirici)

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
3. **Yeni müşteri** ile kayıt ekleyin (Site, Ad, Soyad, Ek bilgi 1–2, Kullanıcı adı, Şifre).
   **Site zorunludur** (örn. `portal.x.com`; adres yapıştırırsanız yalnız alan adı kalır). Eklenti bir sitede
   yalnız o sitenin kayıtlarını gösterir; aynı müşteri iki sitedeyse iki ayrı kayıt açın.
4. Giriş sayfası açılınca panel alanın sağında kendiliğinden açılır (en çok 5 kişi; yazdıkça arar). İsmi yazın,
   kişiyi seçin. Panel kapandıysa kullanıcı adı alanındaki yeşil anahtar simgesi açar/kapatır. Şifre alanındaki göz
   şifreyi gösterir/gizler (sitenin kendi "şifreyi göster" düğmesi varsa EasyPass gözü çıkmaz). Eklentiyle yaptığınız yeni girişleri de
   eklenti "Kaydedilsin mi?" diye sorarak kasaya ekler; uygulama listesi en geç 2 sn içinde yenilenir.
5. Arayüz dili varsayılan **Rusça**; Ayarlar → **Язык / Dil** ile Türkçeye geçilir (eklenti de aynı dili kullanır).

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
| Panel "Güvensiz sayfa (http)" diyor | Eklenti şifreyi yalnız `https://` sayfalara yazar (`localhost` ve `*.localhost` hariç); adresi `https://` ile açın. |
| Açılışta "Kasa dosyası bulunamadı … yedeği var" | Kayıt yarıda kalmış ya da bulut klasörü eşitlenmemiş. Bekleyip yeniden açın; dosya gelmezse `vault.ezp.bak` kopyasını `vault.ezp` adıyla açın. |

## Geliştirme

- .NET 10 SDK: `dotnet test EasyPass.slnx` (Windows). Mac/Linux'ta WPF projesi
  `-p:EnableWindowsTargeting=true` ile derlenir ama çalışmaz; testler için
  `dotnet test tests/EasyPass.Tests` kullanın.
- `EASYPASS_HOME` ortam değişkeni ayar klasörünü (`settings.json`, `key.bin`) `%APPDATA%\EasyPass` yerine
  verilen klasöre çevirir (geliştirme ve CI duman testleri için; Windows `APPDATA` değişkenini dikkate almaz).
- Eklenti testi (Mac, Playwright): `cd extension/test && npm install && npm test` (ru + tr; `openssl` gerekir).
- Uçtan uca test (Windows, EasyPass kurulu): `cd extension/test && npm install && node e2e-windows.mjs` — kurulu
  `EasyPass.Host.exe`, ayrı bir test kasası (`%LOCALAPPDATA%\EasyPass-e2e`, ana şifre `test1234`) ve beş yerel test
  sitesiyle görünür bir Chrome for Testing penceresinde giriş, üye ol → kaydet, şifre değiştir → güncelle, göz ve
  site ayrımını dener. Kendi Chrome'unuz ve kasanız değişmez. `--open`: bittiğinde pencere açık kalır.
- Test sitelerini kendi Chrome'unuzda denemek: `node extension/test/sites.mjs 8080 --vault <yeni-dosya.ezp>` →
  `http://hizlikargo.localhost:8080` gibi beş site; `--vault` sitelerin müşterileriyle bir kasa yazar (ana şifre
  `test1234`), EasyPass'te "Var olan kasayı aç" ile açın.
- Her push'ta GitHub Actions (`.github/workflows/build.yml`, windows-latest) derler, test eder
  (gerçek `EasyPass.Host.exe` uçtan uca dahil), `EasyPass.exe`'yi iki kez başlatıp açılış ekranlarını dener ve
  `publish\` + `extension\` + `scripts\` içeren `EasyPass` zip'ini çıktı olarak yükler.
- Tasarım: `docs/superpowers/specs/2026-10-16-easypass-design.md`.
