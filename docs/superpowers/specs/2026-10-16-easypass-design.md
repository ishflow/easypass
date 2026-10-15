# EasyPass v1 — Tasarım (spec)

Tarih: 2026-10-16 · Durum: onaylandı (kullanıcı "soru sorma" dedi; kararlar aşağıda "Karar" olarak işaretli)

## 1. Sorun ve hedef

Ofiste yüzlerce müşterinin aynı siteye (ve birkaç başka siteye) girişini biz yapıyoruz. Şifreler
Chrome Password Manager'da birikti; Chrome giriş sayfasında yavaşlıyor, donuyor.

**Hedef:** Şifreleri Chrome'dan çıkarıp hafif bir Windows uygulamasına koymak. Chrome eklentisi giriş
alanının yanında bir arama kutusu açar, "Ahmet" yazınca Ad-Soyad'a göre süzer, tıklayınca kullanıcı
adı + şifre milisaniyeler içinde forma yazılır.

**Başarı ölçütleri**
1. Arama yanıtı (eklenti → uygulama → eklenti) < 20 ms, 5.000 kayıtta bile.
2. Şifre dosyası tek, AES-256-GCM ile şifreli; Google Drive / Yandex Disk klasörüne konabilir; format
   sonrası yeni bilgisayarda yalnız ana şifreyle açılır.
3. Uygulama kapalıyken de eklenti çalışır (Chrome yardımcı süreci kendisi başlatır).
4. Sitede şifre değişince eklenti "EasyPass'te güncellensin mi?" diye sorar.
5. Hiçbir işlem veri kaybetmez: her kayıt atomik yazılır, bir önceki sürüm `.bak` olarak kalır.

## 2. Mimari

```
Chrome eklentisi (MV3)  ── Native Messaging (stdin/stdout, JSON) ──  EasyPass.Host.exe (konsol)
                                                                         │
EasyPass.exe (WPF, el ile ekle/düzenle) ─────────────┐                   │
                                                      ▼                   ▼
                                           EasyPass.Core (ortak kütüphane)
                                                      │
                               vault.ezp  (AES-256-GCM, bulut klasöründe olabilir)
                               %APPDATA%\EasyPass\settings.json  (kasa yolu)
                               %APPDATA%\EasyPass\key.bin        (DPAPI ile korunan anahtar önbelleği)
```

**Karar — Native Messaging, localhost sunucusu değil.** Chrome yardımcı süreci kendisi başlatır
(uygulama açık olmasa da çalışır), port yok, başka siteler erişemez, yalnız bizim eklenti ID'si
konuşabilir. Port açık kaldığı sürece süreç yaşar; her istek ~1 ms.

**Karar — Host ayrı küçük konsol exe.** WPF'i yüklemez, hızlı açılır, Mac/Linux'ta da derlenir
(eklenti uçtan uca Mac'te test edilebilir).

**Karar — .NET 10 (LTS).** WPF + `AesGcm` + `Rfc2898DeriveBytes.Pbkdf2` hazır, ek paket yok.
Framework-dependent yayın: exe'ler küçük; kurulum betiği .NET 10 Desktop Runtime yoksa winget ile kurar.

## 3. Veri

Kayıt (`Entry`): `id` (guid "N"), `site` (§3a), `firstName` (Ad), `lastName` (Soyad), `extra1` (Ek bilgi 1),
`extra2` (Ek bilgi 2), `username` (Kullanıcı adı), `password` (Şifre), `updatedAt` (UTC).

Dosya `vault.ezp`:
```
"EZP1" (4 bayt) | iterations int32 LE (4) | salt (16) | nonce (12) | tag (16) | ciphertext
```
- Anahtar = PBKDF2-HMAC-SHA256(ana şifre, salt, 600 000 tur, 32 bayt).
- Düz metin = UTF-8 JSON `{"entries":[…]}` (camelCase).
- AES-256-GCM, ilk 24 bayt (magic+iterations+salt) associated data. Yanlış şifre → `CryptographicException`.
- Her kayıtta yeni nonce; salt yalnız ana şifre değişince değişir (anahtar önbelleği geçerli kalsın diye).

**Anahtar önbelleği:** Kilit bir kez açılınca türetilmiş anahtar (salt'la birlikte) Windows DPAPI
(CurrentUser) ile `%APPDATA%\EasyPass\key.bin`'e yazılır. Host bu anahtarla açar → eklenti için ayrıca
şifre sorulmaz. Salt eşleşmezse (başka bilgisayarda şifre değişmiş) önbellek geçersiz → "kilitli".
"Kilitle" düğmesi önbelleği siler. Windows dışında önbellek yok (host "kilitli" döner).

**Karar — Ana şifre, DPAPI değil, dosyayı korur.** DPAPI makineye bağlıdır, format sonrası açılmaz.
Ana şifre taşınabilir; DPAPI yalnız yerel kolaylık önbelleği.

## 3a. Siteye göre ayrım (Uba şartı)

2-3 farklı sitemiz var; X sitesinde yalnız X'in kayıtları görünür, Y'ninkiler asla.
- `Entry.Site`: zorunlu, normalize edilmiş host adı (küçük harf, `www.` yok, port/yol yok), örn. `portal.x.com`.
  Aynı müşteri iki sitede = iki ayrı kayıt.
- `Sites.Normalize(string)`: URL ya da host kabul eder → host. `Sites.Matches(entrySite, pageHost)`: eşit ya da
  `pageHost` `"." + entrySite` ile bitiyor (alt alan adı). Başka hiçbir eşleşme yok.
- Host `search` / `check` / `add` isteklerinde `site` ZORUNLU (sayfanın `location.hostname`'i); yoksa `bad_request`.
  `search` ve `check` yalnız o siteyle eşleşen kayıtlarda çalışır; `get` ve `update` kaydın sitesi istekteki `site`
  ile eşleşmiyorsa `not_found` (başka sitenin şifresi asla dönmez).
- Uygulamada Site alanı zorunlu (düzenlenebilir ComboBox: kasadaki mevcut siteler + elle yazma, URL yapıştırılırsa
  normalize). Listede "Site" sütunu; uygulama araması site metnini de kapsar.
- Eklentide panelin üstünde hangi site için arandığı yazar (örn. `portal.x.com`).

## 4. Eşzamanlılık ve güvenli yazma

- Tüm yazmalar `Vault.Update(Action<List<Entry>>)` üzerinden: adlandırılmış `Mutex("EasyPass.Vault")`
  al → dosya değiştiyse yeniden oku → değişikliği uygula → kaydet.
- Kaydet: `vault.ezp.tmp` yaz → `File.Replace(tmp, path, path + ".bak")`; bulut sürücüsü Replace'i
  desteklemezse `File.Copy(path, .bak, true)` + `File.Copy(tmp, path, true)` + tmp sil.
- Okuyucular (host her istekte, uygulama pencere etkinleşince) `ReloadIfChanged()` çağırır:
  `LastWriteTimeUtc` + `Length` değiştiyse yeniden çöz.

## 5. Native Messaging protokolü

Çerçeve: 4 bayt uzunluk (little-endian) + UTF-8 JSON. Her istekte `id`, yanıtta aynı `id`.

| İstek | Yanıt |
|---|---|
| `{id,cmd:"status"}` | `{id,ok:true,locked:false,count:N,lang}` (kilitliyse `{id,ok:false,error:"locked",lang}`) |
| `{id,cmd:"search",site,q}` | `{id,ok:true,items:[{id,firstName,lastName,extra1,extra2,username}]}` (en çok 20, şifre YOK) |
| `{id,cmd:"get",site,entryId}` | `{id,ok:true,username,password}` |
| `{id,cmd:"check",site,username,password,entryId?}` | `{id,ok:true,result:"same"\|"changed"\|"new"\|"ambiguous",entryId?,name?}` |
| `{id,cmd:"update",site,entryId,password}` | `{id,ok:true}` |
| `{id,cmd:"add",site,firstName,lastName,username,password}` | `{id,ok:true,entryId}` |
| hata | `{id,ok:false,error:"locked"\|"not_found"\|"bad_request"\|"<mesaj>"}` |

`check` kuralı: `entryId` verilmiş ve varsa onunla karşılaştır. Yoksa kullanıcı adına göre (büyük/küçük
harf duyarsız, tam eşleşme): 0 → `new`; 1 → `same`/`changed`; >1 → biri aynı şifreyse `same`, değilse
`ambiguous` (eklenti sessiz kalır).

**Arama:** Türkçe katlama (`ş→s ç→c ğ→g ı→i İ→i ö→o ü→u`, küçük harf). Sorgu kelimelere bölünür;
her kelime "ad soyad kullanıcıadı ek1 ek2" metninde geçmeli. Sıralama: ad veya soyadı sorgunun ilk
kelimesiyle başlayanlar önce, sonra Ad+Soyad alfabetik. Boş sorgu → son güncellenen 20.

## 6. Chrome eklentisi (MV3)

- `manifest.json`: `nativeMessaging`, `storage`; içerik betiği `<all_urls>` (yalnız üst çerçeve);
  sabit eklenti ID'si için `key` alanı (açık anahtar). Host manifesti yalnız bu ID'ye izin verir.
- `background.js`: tek `connectNative("com.easypass.host")` portu; `id` → Promise eşlemesi; port
  koparsa bekleyenleri hata ile bitir, sonraki istekte yeniden bağlan. Sekme başına `lastFilled`
  (son doldurulan kayıt) ve `pending` (sorulacak güncelleme) `chrome.storage.session`'da.
- `content.js` (Shadow DOM, sayfa stilinden yalıtılmış):
  - Kullanıcı adı alanı = sayfadaki ilk görünür şifre alanından önceki görünür text/email/tel alanı
    (aynı formda). Bu alana ya da şifre alanına odaklanınca alanın sağında (yer yoksa altında) panel
    açılır, arama kutusu odaklanır.
  - Yazdıkça `search` (bekletme yok — yanıt ~ms). ↑↓ seç, Enter doldur, Esc kapat (odak alana döner,
    o alan yeniden odaklanana kadar panel açılmaz).
  - Seçim → `get` → değerler native setter + `input`/`change` olaylarıyla yazılır (React/Vue siteleri).
  - Gönderim yakalama: `submit` (capture), formdaki submit düğmesine tık, şifre alanında Enter.
    Kullanıcı adı + son şifre alanı okunur. Birden çok şifre alanı (şifre değiştirme formu) → son alan
    yeni şifre, kayıt = sekmenin `lastFilled`'ı.
  - `check` sonucu `changed` → "Şifre değişti. EasyPass'te güncellensin mi? [Güncelle] [Hayır]".
    `new` → "Bu giriş EasyPass'te yok. Kaydedilsin mi?" + Ad / Soyad kutuları + [Kaydet] [Hayır].
    Sayfa yönlenirse soru yeni sayfada `pending`'den tekrar gösterilir (2 dk sonra düşer).
- `popup.html`: durum — "Bağlı · N müşteri" / "Kilitli — EasyPass'i açıp ana şifreyi girin" /
  "Bağlantı yok — kurulum betiğini çalıştırın".

## 7. Windows uygulaması (WPF)

Ekranlar (tasarım kanvası: https://claude.ai/artifact/PXa1SJwaHf9mgsEBRqimk5):
1. **Kurulum** (kasa yolu yok): "Yeni kasa oluştur" (konum seç + ana şifre ×2) / "Var olan kasayı aç"
   (dosya seç + ana şifre). İpucu: Google Drive / Yandex Disk klasörü seçin.
2. **Kilit** (önbellek geçersiz): ana şifre kutusu, "Aç".
3. **Ana ekran:** üstte arama, "Yeni müşteri" düğmesi; solda liste (Ad Soyad, kullanıcı adı, ek
   bilgiler); sağda seçili kaydın düzenleme paneli (6 alan, şifre göster/gizle, kopyala, Kaydet, Sil).
   Her 2 sn `ReloadIfChanged` (yalnız tarih/boyut kontrolü): eklentiden eklenen kayıt pencere odakta
   olmasa da anında listede; kaydedilmemiş düzenleme ezilmez.
4. **Ayarlar:** kasa dosyası yolu (başka kasa aç), ana şifreyi değiştir, kilitle, Chrome bağlantısı
   durumu (kayıt defteri anahtarı var mı) ve eklenti klasörü yolu.

Görünüm: Segoe UI Variable; zemin #F6F5F2, yüzey #FFFFFF, metin #1C1F23, ikincil metin #5B6168,
çizgi #E3E1DC, vurgu #0E7C6B (üzerinde beyaz), vurgu açık #E3F1EE, tehlike #B42318; köşe 8 px,
satır yüksekliği 44 px. Ağır animasyon yok.

## 7a. Dil (Rusça varsayılan, Türkçe)

Uygulama daha çok Rusça kullanılacak. Arayüz iki dilli: **Rusça (varsayılan)** ve Türkçe.
- Tek ayar: `settings.json` → `"lang": "ru" | "tr"` (`AppPaths.Lang`, yoksa `ru`). Ayarlar ekranında
  "Язык / Dil" seçimi; anında uygulanır.
- WPF: `Strings.ru.xaml` / `Strings.tr.xaml`, metinler `DynamicResource`.
- Eklenti: dil tarayıcıdan değil uygulamadan gelir: host `status` yanıtı `lang` taşır
  (kilitliyken de); eklenti kendi küçük `{ru,tr}` sözlüğünü kullanır.
- Arama: Kiril küçük harf + `ё→е` katlama (Семён ↔ семен).

## 8. Kurulum ve teslim

- `scripts/install.ps1` (yönetici gerekmez): .NET 10 Desktop Runtime kontrolü (yoksa `winget`),
  `dotnet publish` (SDK varsa) ya da hazır `publish/` klasörü → `%LOCALAPPDATA%\EasyPass\`,
  host manifesti yaz, `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.easypass.host`,
  Başlat menüsü kısayolu. Eklenti: `chrome://extensions` → Geliştirici modu → "Paketlenmemiş yükle"
  → `extension/` klasörü.
- GitHub Actions (`windows-latest`): derle + test + `publish` zip'ini artifact olarak yükle.

## 8a. Anında eşitleme (Uba şartı)

- Uygulamada Kaydet → dosyaya hemen yazılır → eklentinin bir sonraki araması görür (host her istekte
  `ReloadIfChanged`; eklentide önbellek yok).
- Eklentide yeni giriş → "kaydedilsin mi?" → Evet → host `add` → kasa → uygulama ≤2 sn içinde gösterir.

## 9. Kapsam dışı (v2)

Chrome CSV içe aktarma, şifre üretici, iframe içindeki formlar, otomatik
kilit zamanlayıcısı, iki bilgisayarda aynı anda yazma çakışması birleştirme, Edge/Brave desteği,
tek dosya kurulum paketi (MSI).
