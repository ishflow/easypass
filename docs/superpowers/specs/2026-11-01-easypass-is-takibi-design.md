# EasyPass — Aylık iş takibi (tasarım)

Tarih: 2026-11-01 · Temel: main 5c0ac5e (v1.5.0) · Durum: Uba onayı bekliyor

"Uba:" = Uba'nın isteği. "Karar:" = tasarımı yazanın kararı; Uba değiştirebilir.

## 1. Amaç

Muhasebeci/ofis çalışanı `https://cabinet.salyk.kg/account/login` üzerinden binlerce müşterinin hesabına girip her ay
ona ne gerekiyorsa onu yapıyor. Bugün EasyPass şifreyi dolduruyor, ama "bu ay kime ne yaptım, ne yarım kaldı, kim kaldı"
bilgisi kimsede yok. Müşteriler de yalnız numarayla kayıtlı, kim olduğu giriş yapmadan görünmüyor.

Hedef: her müşterinin her ayının kaydı aynı kasa dosyasında dursun; işi yarım kalan hatırlatılsın; yeni ayda kime
bakılacağı liste olarak hazır olsun; müşteri ada göre bulunsun.

**Başarı:**
1. Çıkış yapınca soru paneli gelir; 3 tıkla kaydedilir; bir sonraki müşteriye geçiş gecikmez.
2. Yarım iş, seçilen saatte tarayıcı kapalıyken bile masaüstünde bildirim açar ve çarpıya basılana kadar durur.
3. Ay başında "Yapılacaklar" geçen ay iş yapılan müşterilerle kendiliğinden doludur.
4. Kasa dosyası diğer bilgisayarda açılınca tüm geçmiş, iş listesi ve hatırlatmalar oradadır. Sunucu yok, internet yok.
5. 5.000 müşteri, 24 aylık geçmişte eklentideki arama hedefi (<20 ms) bozulmaz; bir kayıt 300 ms'yi geçmez (testle ölçülür).

## 2. Kapsam

Yapılacak:
- Uygulamada iş tanımları (artı ile ekleme).
- Takipli sitede çıkış sonrası "hangi işleri yaptın" paneli.
- Yeşil / turuncu / gri durum ve turuncuya hatırlatma seçimi.
- Masaüstü bildirimi, Bildirimler ekranı, Yapılacaklar ekranı, müşteri başına ay ay geçmiş.
- Girişten sonra müşterinin adını siteden yakalayıp kayda yazma.
- Arka planda çalışma (tepsi simgesi, Windows açılışında başlama).

Yapılmayacak: sunucu/eşitleme servisi; yapılan işi siteden otomatik anlama; rapor/dışa
aktarma; ertele düğmesi; uygulama içinden geçmiş düzeltme (düzeltme için müşteriye yeniden girilir); iki bilgisayarda aynı
anda yazma birleştirmesi (hep tek kişi, sırayla); ЭЦП/Jacarta/SmartID gibi şifresiz giriş sekmeleri (girişi yakalayamayız).

Olmamalı (iş çalışsa bile başarısızlık sayılır): bildirimde şifre görünmesi; panelin kasadan veri silmesi ya da mevcut
giriş/doldurma akışını bozması; bildirimin kendi kendine kapanması; verinin bilgisayar dışına çıkması.

## 3. Veri (tek dosyada)

Uba: her şey mevcut tek kasa dosyasında. Dosya biçimi değişmez (`EZP1`, AES-256-GCM); düz metin JSON büyür:

```jsonc
{
  "entries": [ /* mevcut; yeni alan: "todoHidden": false */ ],
  "tasks": [ { "id": "…", "name": "Страховка", "archived": false } ],   // sıra = ekleme sırası
  "work": [ { "entryId": "…", "month": "2026-11",
              "tasks": { "<taskId>": "done" | "partial" }, "updatedAt": "…" } ],
  "reminders": [ { "id": "…", "entryId": "…", "taskId": "…", "month": "2026-11",
                   "dueAt": "<UTC>", "dismissedAt": null, "resolvedAt": null } ]
}
```

- Gri = kayıt yok. Bir ayda hiç yeşil/turuncu kalmadıysa o `work` kaydı silinir.
- İş tanımları ortak bir havuz; her müşterinin kendi seçili işleri var (§7d). Uba ilk denemeden sonra böyle düzeltti.
- İş silinince `archived = true`: yeni panelde görünmez, geçmişte adıyla kalır. Yeniden adlandırma geçmişi de günceller.
  Karar: silinen iş §6 gruplarında sayılmaz ve açık hatırlatmaları `resolvedAt` ile kapanır (silinen iş için bildirim çıkmaz).
- Karar: (müşteri, iş, ay) başına tek hatırlatma. Yeni saat seçilirse saat değişir ve `dismissedAt` temizlenir. Bildirimi
  kapatılmış turuncu iş turuncu kalır; panelde "напоминание закрыто" yazar, yeni saat seçmek isteğe bağlıdır.
- Müşteri silinirse `work` ve `reminders` kayıtları da silinir (mevcut silme onayı metninde belirtilir).
- Ay yerel saate göre belirlenir ve girişin yapıldığı aya yazılır (31'inde girip 1'inde kaydetse de).
- Yazmalar mevcut `Vault.Update` kuralıyla: mutex, yeniden oku, kopya üzerinde değiştir, atomik kaydet. `.bak` kalır.
  `Update` imzası müşteriler dışını da kapsayacak şekilde genişler; kopya kuralı yeni listeler için de geçerlidir.
- Boyut tahmini: müşteri-ay başına ~120 bayt; 5.000 müşteri × 24 ay ≈ 15 MB JSON. Sıkıştırma yok; §1.5'teki test bunu
  ölçer, geçemezse kurucu aynı kapsül içinde Deflate ekler.

**Sürüm uyumu:** eski sürüm (v1.5) yeni dosyayı açıp kaydederse bilmediği alanları siler. İki bilgisayar da aynı anda
güncellenmeli; yeni sürüm ilk çalıştığı anda değil, ilk yeni alan yazıldığında geçer. README'ye yazılır.

## 4. Uygulama (WPF)

Ana pencerenin üstüne dört sekme. Karar: mevcut Müşteriler ekranı aynen kalır, diğerleri yanına eklenir.

1. **Клиенты / Müşteriler:** bugünkü ekran; sağ panelin altına **ay ay geçmiş**: "Ноябрь 2026: Страховка ●yeşil, НДС ●turuncu"
   (en yeni üstte, salt okunur). Uba: "3 ay önce bu işi yaptım" diyebilsin.
2. **К выполнению / Yapılacaklar** (§6).
3. **Уведомления / Bildirimler** (§5; sekmede okunmamış sayısı).
4. **Работы / İşler:** liste + `+` düğmesi: basınca satır içi yazı kutusu açılır, Enter ile eklenir, tekrar `+`. Her satırda
   yeniden adlandır ve sil. Metin serbest (çoğunlukla Rusça). İş sayısı sınırsız.

Dil: uygulamanın üç dili (ru varsayılan, tr, en) tüm yeni metinleri kapsar; eklenti metinleri de öyle.

**Arka plan:** Pencereyi kapatmak uygulamayı kapatmaz, tepsiye iner (WinForms `NotifyIcon`, SDK içinde, ek paket yok).
Tepsi menüsü: Aç / Çıkış. Windows açılışında sessiz başlar (HKCU Run, `--background`; kurucu ekler). Tek örnek: ikinci
çalıştırma var olan pencereyi öne getirir. Kaydedilmemiş düzenleme uyarısı "Çıkış"ta ve pencere kapanırken korunur.
Kurulum/güncelleme arka planda çalışan uygulamayı da doğru kapatmalı (bugünkü `AppRunning` adımı).

## 5. Bildirim

Uba: tarayıcıdan değil programdan; telefonla uğraşırken bile ekranda görünsün; kendi kapanmasın.

- Karar: Windows toast değil, kendi küçük penceremiz; çünkü Windows toast kendi kapanır ve Eylem Merkezi'ne düşer.
  Ekranın sağ altında, her zaman üstte, odağı çalmaz, görev çubuğunda yok, tek kısa sistem sesi.
- İçerik: "Работа не завершена", iş adı, müşteri adı, **login numarası**. **Şifre asla.** (Karar: Uba'nın "login ve parol
  gözükmeyecek, hangi loginse o gözüksün" sözü: şifre yok, hangi müşteri olduğu var.)
- Pencereye (çarpı dâhil) tıklamak kapatır; `dismissedAt` kasaya yazılır, diğer bilgisayarda da yeniden çıkmaz. Başka
  otomatik kapanma yok. Kapatılmadan uygulama yeniden başlarsa yeniden çıkar.
- 30 sn'de bir denetim. Kaçırılan (bilgisayar kapalıydı) ilk açılışta çıkar. Aynı anda en çok 5 pencere üst üste; kalanı
  "+N" satırıyla Bildirimler'e götürür.
- Saat geldiğinde kasaya yazılmaz; yalnız kullanıcı eylemi yazar. Böylece iki bilgisayar aynı anda açık dururken
  yazma çakışması çıkmaz. Listeyi "vakti gelmiş" olanlar oluşturur, kaydedilmiş ayrı "gelen kutusu" yok.
- **Bildirimler ekranı:** vakti gelmişler yeniden eskiye sıralı (iş, müşteri, login, saat, kapatıldı mı); vakti gelmemişler
  ayrı "Planlandı" başlığı altında. Müşteri satırına tıklayınca o müşteri açılır. O iş sonradan yeşil ya da gri yapıldıysa
  `resolvedAt` dolar ve bildirim çıkmaz; listede "tamamlandı" görünür.
- Kasa kilitliyse (ana şifreli kasada önbellek yok) bildirim çıkamaz; tepsi simgesi ipucunda "kilitli" yazar.

## 6. Yapılacaklar

Uba: yaptıkça yakalanır; bu ay iş yapılan müşteri gelecek ay listeye girer. Bildirim çıkarmaz, yalnız listedir.

- Ay M'nin listesi = M'den önce en az bir `work` kaydı olan, M'de kaydı olan ya da en az bir etkin seçili işi olan (§7d; kaydı yoksa **Не начато**), `todoHidden` olmayan müşteriler.
- Karar: bir ay atlanan müşteri listeden düşmez, çünkü düşerse sessizce unutulur. Artık bakılmayan müşteri için satırda
  "Убрать из списка" düğmesi (`todoHidden`); yeniden iş kaydedilirse otomatik geri gelir.
- Gruplar: **Не начато** (M'de kayıt yok) · **Не завершено** (M'de turuncu var) · **Готово** (M'de yeşil var, turuncu yok).
  Üstte sayılar: "Готово 120 / 1400".
- Satır: ad soyad (yoksa login), login, en son iş yapılan ayın işleri renkli, M'nin işleri renkli.
- Arama kutusu (mevcut Türkçe/Kiril katlamalı arama), ◀ ▶ ile önceki aylar. Satıra tıklayınca Müşteriler'de o kayıt açılır.
- Binlerce satır için sanallaştırılmış liste.

Hesap `EasyPass.Core` içinde, arayüzsüz ve Mac'te test edilebilir olur.

## 7. Tarayıcı akışı

Yalnız takipli site(ler)de: `cabinet.salyk.kg`, giriş yolu `/account/login`. Karar: eklentide küçük sabit tablo (host, giriş
yolu); ayar ekranı yok. Diğer sitelerde mevcut davranış aynen sürer.

Site gerçeği (herkese açık sayfadan okundu): sunucu taraflı ASP.NET MVC, her geçiş tam sayfa yüklemesi; form
`POST /account/login`, `Username` alanı `type=number`, iframe yok; `/account/logout` var; oturumsuz sayfalar
`/account/login?ReturnUrl=…` adresine döner. Şifreden sonra kuruluş seçme sayfası gelir (§8).

**Oturum takibi** (background, `chrome.storage.local`; yalnız `entryId`, ay ve zaman saklanır, şifre/login yok; aynı anda tek
müşteri, çünkü site çerezi tarayıcıda tektir):
1. Giriş sayfasında form gönderilir (mevcut `submitted`) → deneme kaydı: `check` sonucundaki `entryId`.
2. Hatalı şifrede sayfa giriş yolunda kalır, oturum açılmaz. `/account/selectorganization` gelirse şifre doğrudur ve ad burada
   okunur (§8). Bu aşamada tam oturum yoktur: `/` adresi hâlâ girişe döner.
3. 2 dakika içinde bu iki yolun dışında sayfa yüklenirse ("Войти" basıldı) oturum açık. "Сбросить" ya da seçim sayfasından dönüş
   oturum açmaz, panel gelmez. Kayıtlı değilse mevcut "Kaydedilsin mi?" sorusu sürer; `add` dönünce oturuma bağlanır,
   "Hayır" derse takip edilmez.
4. Çıkış sayılır: logout bağlantısına/formuna gerçek tıklama (href ya da action içinde `logout`) ya da oturum açıkken giriş
   yoluna dönmek. İkincisi site oturumu zaman aşımıyla düştüğünde de çalışır.
5. Sonraki sayfa yüklemesinde panel açılır. Sekme ya da Chrome kapatıldıysa panel bir sonraki siteye girişte önceki müşteri için
   açılır, başlıkta adı yazar. Yeni müşteriye geçmeden sorulmuş olur.

**Panel** (Shadow DOM, mevcut eklenti görünümü; sayfanın ortasında, arkası karartılmış; panel açıkken giriş arama paneli açılmaz):
- Başlık: müşteri adı · login. Altında işler: tanımlı her iş bir satır; satırda iş adı ve iki düğme: **Сделано** (yeşil),
  **Не завершено** (turuncu). Başlangıçta gri. Basılı düğmeye tekrar basmak griye döndürür.
- Aynı ay ikinci girişte önceki durumlar dolu gelir. Turuncu bu sefer yeşil yapılırsa eski hatırlatma kapanır.
- Turuncuya basılınca satırın altında: **2 часа · 5 часов · Завтра · Через 2 дня · [ ] часов/дней**. Serbest sayı + birim
  seçilir. Uba'nın sayıları bunlar.
- Karar: "Yarın" ve gün seçenekleri o günün 09:00'u (gece bildirim çıkmasın); saat seçenekleri tam şimdi + N saat.
- Karar: turuncu için hatırlatma seçmek zorunlu; seçilmeden Сохранить pasif. Daha önce seçilmişse mevcut saat görünür ve
  yeniden seçim gerekmez.
- **Сохранить** kaydeder, oturumu bitirir. **Закрыть** (Esc) kaydetmeden kapatır, oturumu bitirir. Hiçbir iş tanımlı değilse panel
  yerine küçük ipucu çıkar: "EasyPass'te iş ekleyin".
- Host yanıt vermez/kasa kilitliyse panel hatayı gösterir ve durumları kaybetmez (yeniden dene).

**Yeni host komutları** (`HostApi`, `background.js` `site`'ı gerçek göndericiden koyar, yalnız takipli siteden kabul eder):
`work_get {site, entryId}` → işler, bu ayın durumları, açık hatırlatmalar · `work_save {site, entryId, month, statuses,
reminders}` · `set_name {site, entryId, text}`. Doğrulama: giriş sitesi eşleşmeli; bilinmeyen `taskId`/durum, geçmiş ya da 1
yıldan uzak zaman reddedilir; metin uzunlukları sınırlı. Yanıtlarda şifre yok. Sayfa betikleri bu mesajlara erişemez.

## 7a. Hız (Uba şartı)

Uba: uygulama ağır olmasın, hızlı çalışsın, tarayıcıyı yormasın.

- Takip kodu ayrı içerik betiğinde (`salyk.js`), yalnız `cabinet.salyk.kg` için yüklenir. Diğer sitelere tek bayt eklenmez.
- Eklentide zamanlayıcı/yoklama yok; yalnız sayfa yüklemesi ve kullanıcı eylemiyle çalışır. Boşta sayfa host'u başlatmaz (bugünkü kural).
- Takipli sitede sayfa yüklemesi fark edilir biçimde yavaşlamaz: oturum durumu okuması ve panel yanıtı < 50 ms (Playwright ölçer).
- Uygulama boşta: 30 sn denetimi bellekteki listeye bakar, dosyayı yalnız damga değiştiyse çözer. Pencere gizliyken yeni ekran çizilmez;
  sekmeler ilk açılışta hesaplanır. Yeni paket yok.
- Yapılacaklar hesabı 5.000 müşteri, 24 ayda < 100 ms (test), liste sanallaştırılmış.

## 7b. Eklentide yardımcı bilgi (Uba: "güzel yardımcı şeyler")

Karar: yalnız şu ikisi; ikisi de yeni istek yükü getirmez.
- Giriş panelinde her müşterinin yanında bu ayın durumu: yeşil nokta (bitti), turuncu nokta (yarım), nokta yok (başlanmadı). Host mevcut
  `search` yanıtına `monthStatus` alanı ekler.
- Araç çubuğu penceresinde üstte tek satır: "Этот месяц: готово 120 · не завершено 8 · не начато 300". Yeni `summary` komutu,
  `all`/`entry` gibi yalnız eklentinin kendi penceresinden kabul edilir.

## 7c. Girmeden iş durumu değiştirme (Uba, ilk denemeden sonra)

Uba: müşteri "onları başkasına yaptırdım, bitti" der; siteye girmeden, eklentide ya da programda ismine tıklayıp yeşile çevirebilmeli.

- **Eklenti araç çubuğu penceresi:** müşteriye tıklayınca açılan ayrıntıda, login ve şifreden **önce**, bu ayın işleri: iş adı + Сделано / Не завершено
  düğmeleri. Çıkış panelinin kuralları aynı (tekrar basınca gri; turuncu için hatırlatma seçimi zorunlu; önceden seçilmiş saat
  korunur). Yalnız takipli sitenin kayıtlarında görünür. Değişiklik düğmeyle değil **Сохранить** ile yazılır.
- **Program, Müşteriler sağ paneli** (Yapılacaklar'dan satıra tıklayınca da aynı yer): düzenleme alanlarının üstünde bu ayın işleri, küçük ve
  sıkışık; aynı düğmeler, aynı hatırlatma seçimi, kendi Сохранить düğmesi. Müşteri formunun kaydından ayrıdır. Altında ay ay geçmiş kalır.
- Karar: yalnız içinde bulunulan ay değiştirilir; geçmiş aylar salt okunur. §2'deki "uygulama içinden geçmiş düzeltme yok" bu kadar değişti.
- Host'a yeni kural yok: `work_get`/`work_save` kaydın kendi sitesiyle çağrılır. Eklentide bu yol yalnız kendi penceresinden (`POPUP_ORIGIN`) ve
  takipli site için açıktır; web sayfası erişemez. Açık bir oturum/panel varsa bozulmaz.

## 7d. Müşteri başına işler (Uba, ilk denemeden sonra)

Uba: havuzda 10-15 iş olabilir, ama her müşteriye hepsi yapılmaz; kimine 1, kimine 8. Müşterinin yapılmayan 14 işi her seferinde karşısına çıkmasın, geçmişinde "yapılmadı" diye kalmasın.

- Veri: `Entry.TaskIds`: `null` = henüz seçilmedi; dolu = bu müşterinin işleri. Havuza eklenen yeni iş mevcut müşterilere kendiliğinden eklenmez.
- **İlk sefer:** müşterinin `TaskIds`'i `null` iken çıkışta önce havuzun tamamı onay kutularıyla gelir: "Bu müşteriye her ay hangi işler yapılır?". En az bir iş seçilmeden **Далее** pasif.
  Далее → seçim kaydedilir → bilinen panel yalnız seçilenlerle açılır. **Закрыть** seçimi kaydetmez, sonraki çıkışta yeniden sorulur. Bu ay zaten yeşil/turuncu olan işler kutularda işaretli gelir.
- **Sonraki seferler:** yalnız seçili işler görünür; iş sayısı ne olursa olsun seçim yeniden sorulmaz.
- **Değiştirme:** Karar: çıkış panelinde, eklenti penceresinde ve program panelinde küçük **Изменить список работ** bağlantısı aynı onay kutularını açar. Olmazsa müşteriye yeni iş eklenemezdi.
- Müşterinin `TaskIds`'i `null` ise eklenti penceresi ve program paneli de aynı seçimle başlar.
- Listeden çıkarılan iş: o ayda ve geçmişte kaydı varsa adıyla kalır, açık hatırlatması `resolvedAt` ile kapanır, panelde görünmez. Havuzdan silinen iş de listeden düşer.
- **§6 grupları** artık müşterinin kendi işlerine göre. Karar: **Готово** = seçili işlerin hepsi yeşil; **Не завершено** = en az biri yeşil/turuncu ama hepsi yeşil değil; **Не начато** = hiçbiri işaretli değil. Seçimi olmayan müşteride eski kural (yeşil var, turuncu yok = Готово). Eklenti noktası ve özet satırı aynı hesabı kullanır.
- Yeni host komutu `work_assign {site, entryId, taskIds}`; `work_get` yanıtına `assigned` (bool) ve `allTasks` eklenir, `tasks` seçili işleri verir (`assigned` yanlışsa boş). Yetki kuralları `work_get`/`work_save` ile aynı.

## 8. Adı yakalama

Uba: numaraya bakıp kim olduğu bilinmiyor; giriş yapınca isim görünüyor, kayda yazılsın, sonra ada göre aransın.

- Gerçek sayfa (2026-11-01, Uba'nın Chrome'unda bir müşteriyle, kişisel metin maskeli okundu): şifreden sonra
  `/account/selectorganization?userName=<login>` gelir. Başlık "Войти через", tablo; her satırda `span.text-gray-800` ad,
  altında `span.text-gray-600` numara, sağda "Войти" (`a.btn-light-primary` → `/account/setorganization?organizationId=…`).
- Görülen örnekte login 17 hane, satırdaki numara 14 hane ve login bu numarayla başlıyor (eşit değil). Tek satır vardı.
- Kural: yalnız bu sayfada, adresteki `userName` denenen login'e eşitse okunur. Tek satırsa onun adı alınır. Çok satırsa yalnız
  login'i kendi numarasıyla başlayan satır alınır (tam olarak bir tane değilse hiçbiri), böylece yanlış ad yazılmaz.
  Kabul şartı: en az iki kelime, rakam yok, 100 karakterden kısa. Login'i host, `entryId`'den `work_get` yanıtında verir.
  Seçiciler tek yerde durur; satır bulunamazsa hata çıkmaz, ad boş kalır.
- Yalnız kayıtta Ad ve Soyad **boşsa** yazar; elle yazılmış ada dokunmaz. Sonraki aylarda ad dolu olduğundan yeniden okumaz.
- Rusça sıra varsayılır: ilk kelime `lastName`, kalanı `firstName`. Tırnak ya da ОсОО/ОАО/ЗАО/ИП ile başlayan şirket adı
  bölünmeden `lastName`e girer.
- Ad okunamazsa panel başlığında login görünür, kayıt bozulmaz, hata çıkmaz; ad elle yazılabilir.

**Doğrulama:** seçim sayfasının yapısı gerçek sayfadan alındı. "Войти" sonrası sayfalar ve çıkış bağlantısı görülmedi (hesabın
içine girilmedi); çıkış §7'deki iki yolla yakalanır, son denemeyi Uba yapar. Çok satırlı örnek görülmedi.

## 9. İki bilgisayar

Uba: şimdilik tek bilgisayar; ileride ev de eklenebilir ama hep tek kişi, sırayla kullanır. Kasa Google Drive ya da Yandex
Disk klasöründe durur, senkronu o yapar. Yeni bir eşitleme ya da birleştirme gerekmez.

- Açık kalan öbür bilgisayar kasaya kendiliğinden yazmaz (§5), yalnız 2 sn'de bir yeniden okur; bu yüzden sırayla kullanımda
  çakışma çıkmaz.
- İkinci bilgisayar eklendiğinde ona da aynı sürüm kurulur (§3 sürüm uyumu).

## 10. Güvenlik

- Şifre yeni hiçbir ekrana, komut yanıtına, bildirime ya da `chrome.storage`'a girmez.
- İş geçmişi ve ad kasa içinde şifreli; dışarıda yalnız `entryId` (rastgele kimlik) durur.
- Repo herkese açık: test verileri uydurma olur, gerçek müşteri adı/numarası/ekran görüntüsü depoya girmez. Sitenin
  ekran görüntüsü ya da HTML'i depoya konmaz.

## 11. Test ve teslim

- `EasyPass.Core`: durum/hatırlatma kuralları, ay devri, liste grupları, eski kasayı açma (v1.5 dosyası veri kaybetmeden
  yükseltilir), boyut/hız testi (§1.5), `HostApi` doğrulamaları. Mac'te ve CI'da.
- Eklenti: mevcut Playwright düzeninde salyk benzeri sahte site (`type=number` login, tam sayfa geçişleri, logout, zaman aşımı,
  hatalı şifre, seçim sayfası tek ve çok satırlı): panel, hatırlatma seçimi, ikinci giriş, kapalı sekme.
- Windows: CI `windows-latest` + mevcut `e2e-windows.mjs` ve `app-shots.ps1`: tepsi, tek örnek, bildirim penceresi, üç dil
  ekran görüntüleri.
- Gerçek sitede son deneme Uba'nındır (müşteri şifresi kullanılır, biz girmeyiz). Uygulama yalnız Windows'ta çalışır ve eklenti
  yerel host'la konuşur: deneme, Parallels içindeki Windows'a kurulup **aynı Windows'taki Chrome** ile yapılır. Mac Chrome'daki
  eklenti Windows'taki uygulamaya bağlanamaz.
- Teslim: yeni sürüm (`v1.6.0`) CI kurucu çıktısı. Eklenti bugünkü gibi kurucuyla gelen klasörden yüklenir (Web Store'da yok).
  GitHub Release yayımlamak Uba'nın o eyleme özel onayıyla yapılır. Eski host yeni komuta `bad_request` döner; panel bunu
  "EasyPass'i güncelleyin" diye gösterir.

## 12. Kurucuya kalanlar

Ekran yerleşimi ayrıntısı (mevcut tema içinde), `Update` API şekli, sınıf/dosya bölümü, tepsi menüsü simgesi, bildirim sesi.

## 13. İlk denemeden sonra eklenenler (Uba)

**Panelden iş ekleme:** Bir ay müşteriye listede olmayan bir iş yapılır. Çıkış panelinin, eklenti penceresinin ve program panelinin altında **+ Добавить работу** düğmesi. Basınca açık ekranın önünde kaydırılabilir bir küçük ekran açılır: havuzdaki, bu müşterinin listesinde olmayan işler onay kutularıyla. **Сохранить** seçilenleri müşterinin listesine ekler, ekran kapanır, yeni işler panelde hemen görünür ve aynı düğmelerle işaretlenir. O ana kadar basılmış düğmeler kaybolmaz. Eklenecek iş kalmadıysa düğme görünmez.

**Kaydedildi işareti:** Her iş kaydından sonra küçük, rahatsız etmeyen "Сохранено" işareti yaklaşık 1 saniye görünür ve kendi kapanır; tıklama beklemez, odak çalmaz. Çıkış panelinde panel kapandıktan sonra sayfanın köşesinde, eklenti penceresinde ve programda kendi içinde.

**Kenar çekmecesi:** Karar: Uba "ekranın sağ tarafı" dedi, bu yüzden tarayıcıda değil masaüstünde, programın kendi penceresi; Chrome'un üstünde de görünür. Sağ kenarda dar, uzunca bir çıkıntı her zaman üstte durur, odak çalmaz. Tıklayınca sağdan sola kayarak açılır (~200 ms); yalnız çıkıntıya tekrar basınca kapanır (Uba). Program penceresi × ile kapatılsa da çıkıntı durur.
- Üst bölüm: bu ayın yapılacakları, **müşteri adları** (ad yoksa login) sırayla: önce Не завершено, sonra Не начато; Готово yok. Üstte sayı.
- Alt bölüm: bekleyenler, yani açık hatırlatması olan yarım işler: müşteri adı, iş adı, saat. Vakti geçenler önce.
- Satıra tıklayınca program penceresi o müşteriyle açılır. Şifre hiçbir yerde görünmez.
- Veri açıkken hesaplanır, kapalıyken iş yapmaz (§7a). Kasa açık değilse çıkıntı görünmez. Liste sanallaştırılmış.
