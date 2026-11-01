# EasyPass — Aylık iş takibi: uygulama planı

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (önerilen) ya da superpowers:executing-plans. Adımlar `- [ ]` ile izlenir.

**Goal:** Her müşterinin her ayının iş kaydı tek kasa dosyasında; yarım iş masaüstünde hatırlatılır; Yapılacaklar listesi kendiliğinden dolar; müşteri adı siteden yakalanır.

**Architecture:** Kurallar ve veri `EasyPass.Core` içinde arayüzsüz (Mac'te test edilir); `HostApi` üç yeni komut + `search`/`summary` eklentisi; WPF dört sekme + tepsi + kendi bildirim penceresi; eklentide yalnız `cabinet.salyk.kg` için yüklenen `salyk.js` ve `background.js` oturum makinesi.

**Tech Stack:** .NET 10 (Core/Host/WPF+WinForms NotifyIcon), Chrome MV3, Inno Setup, xUnit, Playwright (`extension/test`).

**Spec:** `docs/superpowers/specs/2026-11-01-easypass-is-takibi-design.md` (onaylı; kararlar yeniden açılmaz).

## Global kısıtlar

- Dosya biçimi `EZP1` + AES-256-GCM değişmez; JSON'a `tasks`, `work`, `reminders`, `entries[].todoHidden` eklenir. Eski (v1.5) dosya veri kaybetmeden açılır.
- Şifre hiçbir yeni yanıta, ekrana, bildirime, `chrome.storage`'a girmez. Yanıtlarda `password` yalnız mevcut `get`/`entry`.
- Yeni NuGet/npm paketi yok. Diğer sitelere tek bayt eklenmez (`salyk.js` yalnız takipli host'ta).
- Üç dil (ru varsayılan, tr, en) tüm yeni metinlerde: `Strings.*.xaml`, `salyk.js` TEXT, `popup.js` TEXT.
- Repo herkese açık: fixture adları/loginleri uydurma; gerçek site HTML'i/ekran görüntüsü depoya girmez. 17 haneli login fixture'ı: `93000000000789123`, sayfadaki 14 haneli numara `93000000000789` (sites.mjs'te zaten var).
- Hız (testle): `Search` < 20 ms, bir `Update` < 300 ms, `TodoList` < 100 ms (5.000 müşteri × 24 ay); sayfada oturum okuması + panel yanıtı < 50 ms.
- Sürüm `1.6.0`: `manifest.json` (W2-B), `EasyPass.iss` (W2-A), README (W3).
- Commit yok; push/CI/Release **onay gerekli**.
- Mac araçları: `~/.dotnet/dotnet` (10.0.402), `DOTNET_CLI_TELEMETRY_OPTOUT=1`. WPF Mac'te çalışmaz; `-p:EnableWindowsTargeting=true` ile derlenmesi **doğrulanacak** (eski plan iddiası). Parallels "Windows 11" VM var (`prlctl list -a`, stopped).

## Bitti ölçütü

1. `~/.dotnet/dotnet test tests/EasyPass.Tests -c Release` Mac'te yeşil (yeni Core/HostApi/sözleşme/hız testleri dahil).
2. `cd extension/test && node run.mjs ru tr en` yeşil: salyk sahte sitesinde panel, hatırlatma seçimi, ikinci giriş, kapalı sekme, hatalı şifre, zaman aşımı, tek/çok satırlı seçim sayfası, eski host → "EasyPass'i güncelleyin".
3. Windows (VM): `dotnet test` yeşil; `EasyPass-Setup-1.6.0.exe` kurulur, tepsi/tek örnek/`--background`/bildirim penceresi elle ve `e2e-windows.mjs` ile doğrulanır; `app-shots.ps1` üç dilde yeni sekmeleri çeker.
4. v1.5 kasası yeni sürümde açılır, ilk iş kaydından sonra v1.5'in alanları sileceği README'de yazılı.
5. Gerçek sitede son deneme Uba'nın (Parallels Windows + aynı Windows'taki Chrome).

## Görev tablosu

| ID | Rol | Model | Effort | Dalga | Bağımlı | Sahip (yalnız bu yollar) | Kabul komutu | Risk |
|---|---|---|---|---|---|---|---|---|
| W1 | Core + HostApi + testler (protokolü sabitler) | opus | high | 1 | — | `src/EasyPass.Core/**`, `tests/EasyPass.Tests/**` | `DOTNET_CLI_TELEMETRY_OPTOUT=1 ~/.dotnet/dotnet test tests/EasyPass.Tests -c Release` | Hız eşikleri CI'da oynak; `Update` imza genişlemesi 5 çağrı yerini etkiler |
| W2-A | WPF App + kurucu + CI smoke | opus | high | 2 | W1 | `src/EasyPass.App/**`, `installer/EasyPass.iss`, `.github/workflows/build.yml` | `~/.dotnet/dotnet build src/EasyPass.App -c Release -p:EnableWindowsTargeting=true` (doğrulanacak); Windows'ta W3 | Mac'te çalıştırılamaz; tepsi/tek örnek hataları W3'te çıkar |
| W2-B | Eklenti: `salyk.js`, `background.js`, `content.js` tek satır, `popup`, `manifest`, Playwright + fake-host + sites | opus | high | 2 | W1 | `extension/**` **hariç** `extension/test/app-shots.ps1`, `extension/test/screenshots.mjs` | `cd extension/test && npm install && node run.mjs ru tr en` ; `node --check extension/*.js` | Gerçek sitenin çıkış/iç sayfaları görülmedi; oturum makinesi |
| W3 | Windows doğrulama + README + ekran görüntüleri | sonnet | medium | 3 | W2-A, W2-B | `README.md`, `docs/images/**`, `extension/test/app-shots.ps1`, `extension/test/screenshots.mjs` | VM'de `dotnet test EasyPass.slnx -c Release`; `node e2e-windows.mjs --headless`; `iscc installer\EasyPass.iss` | VM'de `prlctl exec` Parallels Tools ister; CI = push = **onay gerekli** |

Aynı anda en çok 2 yazar: W1 tek; W2-A ∥ W2-B; W3 tek. Paylaşılan dosyalar tek sahipli: `Strings.*.xaml` → W2-A; `manifest.json`, `background.js`, `content.js`, `fake-host.mjs`, `sites.mjs`, `run.mjs`, `e2e-windows.mjs` → W2-B; `build.yml` → W2-A. W3 kod düzeltmesi gerekirse ilgili sahibe geri verir (kendisi `src/`/`extension/` koduna yazmaz).

## Host protokolü (W1 sabitler; W2-A/W2-B buna yazar)

Mevcut kurallar aynen: `{id}` yankılanır, `ok:false` → `error`. Yeni komutlar `background.js` tarafından yalnız takipli siteden (`work_*`, `set_name`) ya da popup'tan (`summary`) kabul edilir; `site` göndericiden konur.

```jsonc
// work_get {site, entryId, month?}      month: "yyyy-MM"; yoksa host yerel saatle bu ay
→ {ok, username, name, month, tasks:[{id,name}],            // yalnız archived=false, ekleme sırası
   statuses:{"<taskId>":"done"|"partial"}, reminders:[{taskId, dueAt:"<UTC ISO>", dismissed:bool}]}
// work_save {site, entryId, month, statuses:{taskId:"done"|"partial"}, reminders:{taskId:"<UTC ISO>"}}
→ {ok}   // statuses boş = kayıt silinir. Hatalar: bad_request (site/entry uyuşmaz, bilinmeyen/arşiv taskId, durum,
         // month formatı ya da bu ay/önceki ay dışı, dueAt < now-5dk ya da > now+1y, 200'den çok anahtar), not_found
// set_name {site, entryId, text}  text ≤ 100
→ {ok, firstName, lastName, changed:bool}   // Ad ve Soyad boş değilse changed:false, kayıt dokunulmaz
// search yanıtı: her öğeye "monthStatus": "done" | "partial" | null (bu ay, yerel saat)
// summary {}  (popup) → {ok, month, done, partial, notStarted}   // §6 gruplarının sayıları
```

Eski host bilinmeyen `cmd`'ye zaten `bad_request` döner (`HostApi.Handle` allowlist) → panel "EasyPass'i güncelleyin".

---

### W1 — Core + HostApi + testler

**Files:** Modify `src/EasyPass.Core/Vault.cs`, `src/EasyPass.Core/HostApi.cs`; Create `src/EasyPass.Core/Work.cs`; Create `tests/EasyPass.Tests/WorkTests.cs`, `tests/EasyPass.Tests/WorkPerfTests.cs`; Modify `tests/EasyPass.Tests/HostApiTests.cs`, `ExtensionContractTests.cs`, `VaultTests.cs`.

**Produces (W2 bunlara yazar):**
```csharp
// Vault.cs
public sealed class Entry { ... public bool TodoHidden { get; set; } }          // JSON todoHidden
public sealed class WorkTask { string Id = Guid N; string Name; bool Archived; }
public sealed class WorkRecord { string EntryId; string Month; Dictionary<string,string> Tasks; DateTime UpdatedAt; } // "done"|"partial"
public sealed class Reminder { string Id; string EntryId; string TaskId; string Month; DateTime DueAt; DateTime? DismissedAt; DateTime? ResolvedAt; }
public sealed class VaultData { List<Entry> Entries; List<WorkTask> Tasks; List<WorkRecord> Work; List<Reminder> Reminders; }
public VaultData Data { get; }                                // bellekteki durum; yalnız okunur, değişiklik hep Update ile
public void Update(Action<VaultData> change);                 // kopya kuralı 4 liste için (WorkRecord.Tasks sözlüğü de kopyalanır)
public void Update(Action<List<Entry>> change);              // mevcut; d => change(d.Entries) sarmalı, çağıranlar değişmez
// Work.cs — saf, arayüzsüz
public static class Work {
  public static string MonthOf(DateTime local);                                  // "yyyy-MM"
  public static bool IsMonth(string s);
  public static string? MonthStatus(IEnumerable<WorkRecord> work, string entryId, string month); // partial > done > null
  public static void Save(VaultData d, string entryId, string month, IReadOnlyDictionary<string,string> statuses,
                          IReadOnlyDictionary<string,DateTime> reminders, DateTime nowUtc);      // ArgumentException("bad_request")
  public static void ArchiveTask(VaultData d, string taskId, DateTime nowUtc);  // Archived=true + açık hatırlatmalar ResolvedAt
  public static void RemoveEntry(VaultData d, string entryId);                   // work + reminders kaskad
  public static IEnumerable<Reminder> Due(VaultData d, DateTime nowUtc);         // DueAt<=now, Dismissed/Resolved null, task aktif, entry var; yeniden eskiye
  public static IEnumerable<Reminder> Planned(VaultData d, DateTime nowUtc);
  public static TodoList Todo(VaultData d, string month);                        // §6
  public static (string LastName, string FirstName)? ParseName(string text);     // §8 kabul: ≥2 kelime, rakam yok, <100; tırnak/ОсОО/ОАО/ЗАО/ИП → hepsi LastName
}
public enum TodoGroup { NotStarted, Unfinished, Done }
public sealed record TodoRow(Entry Entry, TodoGroup Group, string? LastMonth, IReadOnlyDictionary<string,string> LastTasks, IReadOnlyDictionary<string,string> ThisTasks);
public sealed record TodoList(IReadOnlyList<TodoRow> Rows, int Done, int Unfinished, int NotStarted);
```

`Save` kuralları (spec §3, §7): bilinmeyen/arşiv `taskId`, `"done"/"partial"` dışı değer → `ArgumentException("bad_request")`. Statuses boşsa `WorkRecord` silinir. Her (entry, task, month) için tek `Reminder`: `partial` + yeni `dueAt` → varsa `DueAt` değişir, `DismissedAt=null`; yoksa eklenir. `partial` + dueAt yok → mevcut hatırlatma dokunulmaz (kapatılmışsa turuncu kalır). `done` ya da gri → açık hatırlatmanın `ResolvedAt=now`. `TodoHidden=false` yapılır (yeniden iş kaydı listeye geri getirir).

- [ ] **Vault**: `Doc` kaydını 4 listeye genişlet; `Load` eksik listeyi `[]` sayar (`VaultTests.Old_v15_file_opens_with_empty_tasks_work_reminders` — v1.5 JSON'u elle üretip yükle). `Update(Action<VaultData>)` + kopya testi `Failed_update_leaves_work_as_on_disk`.
- [ ] **Work.cs** testleri (`WorkTests`): `MonthOf_uses_local_date`, `Save_rejects_unknown_task_and_bad_status`, `Save_partial_creates_single_reminder_and_reset_clears_dismissed`, `Save_done_resolves_open_reminder`, `Save_empty_removes_record_and_unhides_todo`, `ArchiveTask_resolves_reminders_and_hides_from_panel`, `RemoveEntry_cascades`, `Due_skips_dismissed_resolved_archived_missing_entry`, `Todo_groups_counts_and_skipped_month_keeps_customer`, `Todo_hidden_customer_returns_after_new_work`, `ParseName_rules` (Theory: `"Тестова Анна Сергеевна"` → (Тестова, Анна Сергеевна); `"ОсОО \"Ак-Жол\""` → (ОсОО "Ак-Жол", ""); `"Иванов"` → null; `"Иванов 123"` → null).
- [ ] **HostApi**: allowlist'e `work_get work_save set_name summary`; yukarıdaki şekiller; `search` öğesine `monthStatus`. `HostApiTests`: `Work_get_returns_tasks_statuses_reminders_without_password`, `Work_save_validates_month_window_and_due_range`, `Work_save_other_site_is_not_found`, `Set_name_only_when_both_names_empty`, `Summary_counts_this_month`, `Old_command_set_unchanged`. `ExtensionContractTests.Search_items_have_exactly_the_fields_the_panel_reads` anahtar listesine `"monthStatus"` eklenir (**spec eklemesi, bilinçli**); yeni `Work_panel_contract` testi JSON şeklini anahtar-anahtar sabitler.
- [ ] **Hız** (`WorkPerfTests`, 5.000 entry × 24 ay work, ~15 MB JSON): `Search_under_20ms`, `Work_save_under_300ms`, `Todo_under_100ms` — en iyi 3 ölçümden biri; geçmezse spec §3'teki Deflate aynı görevde eklenir (`EZP1` başlığı değişmez, düz metin sıkıştırılır).
- [ ] Kabul: `DOTNET_CLI_TELEMETRY_OPTOUT=1 ~/.dotnet/dotnet test tests/EasyPass.Tests -c Release` → tümü PASS.

---

### W2-A — WPF App + kurucu + CI smoke

**Files:** Modify `src/EasyPass.App/EasyPass.App.csproj` (`<UseWindowsForms>true</UseWindowsForms>`), `Program.cs`, `MainWindow.xaml(.cs)`, `Strings.{ru,tr,en}.xaml`; Create `TodoView.xaml(.cs)`, `NotificationsView.xaml(.cs)`, `TasksView.xaml(.cs)`, `ReminderWindow.xaml(.cs)`, `ReminderService.cs`, `TrayIcon.cs`; Modify `installer/EasyPass.iss`, `.github/workflows/build.yml`.

**Consumes:** W1 `Vault.Update(Action<VaultData>)`, `Work.*`, `TodoList`, `Reminder`.

- [ ] **Program.cs**: `Main(string[] args)`. Tek örnek: `Mutex("EasyPass.App")`; ikinci örnek `EventWaitHandle("EasyPass.App.Show")` set edip çıkar; `--quit` → `EventWaitHandle("EasyPass.App.Quit")` set edip çıkar (kurucu kullanır); `--background` → pencere `Hide()` ile başlar. Ana süreç iki event'i arka plan iş parçacığında bekler ve `Dispatcher` ile öne getirir / `Quit()` çağırır.
- [ ] **Tepsi** (`TrayIcon.cs`, WinForms `NotifyIcon`, ikon `app.ico`): menü Aç / Çıkış; çift tık = Aç; ipucu `vault == null ? L("TrayLocked") : "EasyPass"`. `Window_Closing`: `quitting` değilse `e.Cancel=true; Hide()`; `ConfirmLeave()` hem gizlerken hem Çıkış'ta korunur. Gizliyken `RefreshList`/sekme hesapları atlanır (`IsVisible` kontrolü), 2 sn yeniden okuma sürer.
- [ ] **Sekmeler**: `MainPanel` içine `TabControl` (`x:Name="Tabs"`): 1) mevcut Müşteriler grid'i aynen + sağ panel altına `HistoryList` (`ItemsControl`, `Current` için `Work` kayıtları, en yeni üstte, "Ноябрь 2026: Страховка ●  НДС ●" renk `DynamicResource` SuccessBrush/WarningBrush); 2) `TodoView`: ◀ ▶ ay, arama kutusu (`Vault.Search` + `Work.Todo` kesişimi), başlık "Готово 120 / 1400", `ListBox` `VirtualizingStackPanel.IsVirtualizing="True"`, satır: ad (yoksa login), login, son ay işleri, bu ay işleri, "Убрать из списка" → `TodoHidden=true`; satıra tık → sekme 1'de `Edit(id)`; 3) `NotificationsView`: `Work.Due` + `Planned` ("Planlandı" başlığı), satır: iş, müşteri, login, saat, kapatıldı/tamamlandı; tık → müşteri; sekme başlığında okunmamış (= `Due` sayısı) ; 4) `TasksView`: liste + `+` → satır içi `TextBox`, Enter ekler ve yeni `+`; her satırda yeniden adlandır / sil (`Work.ArchiveTask`). Sekme içerikleri `SelectionChanged` ve `ReloadFromDisk` sonrasında yalnız görünür sekme için hesaplanır. `AutomationId` ver: `Tabs`, `TodoList`, `NotificationList`, `TaskList`, `AddTask`.
- [ ] **Bildirim** (`ReminderService`): `DispatcherTimer` 30 s + açılışta bir kez; `Work.Due(vault.Data, UtcNow)` bellekten (dosyayı yalnız 2 sn yeniden okuma çözer). Her due için açık `ReminderWindow` yoksa açar: `Topmost=true`, `ShowInTaskbar=false`, `ShowActivated=false`, `WindowStyle=None`, sağ alt, `SystemSounds.Asterisk` bir kez; metin "Работа не завершена" + iş adı + müşteri adı + **login** (şifre yok). En çok 5 pencere üst üste; fazlası tek "+N" satırı → tıklanınca Bildirimler sekmesi. Pencereye/çarpıya tık → `vault.Update(d => reminder.DismissedAt = now)` → kapanır. Otomatik kapanma yok; uygulama yeniden başlarsa kapatılmamışlar yeniden çıkar. Kasa yoksa pencere yok, tepsi ipucu "kilitli".
- [ ] **Silme**: `Delete_Click` → `vault.Update(d => Work.RemoveEntry(d, id))`; `AskDelete` metnine iş geçmişi/hatırlatmaların da silineceği eklenir.
- [ ] **Strings**: üç dosyaya aynı anahtarlar: `TabClients TabTodo TabNotifications TabTasks TodoDone TodoUnfinished TodoNotStarted TodoHide TodoTitleFmt NotifDue NotifPlanned NotifDismissed NotifResolved NotifTitle NotifMore TaskAdd TaskRename TaskDelete AskDeleteTask TrayOpen TrayExit TrayLocked History` (+ ay adları için `CultureInfo` ru/tr/en `MMMM yyyy`).
- [ ] **Kurucu**: `#define AppVersion "1.6.0"`; `[Registry]` `Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueName: "EasyPass"; ValueData: """{app}\EasyPass.exe"" --background"; Flags: uninsdeletevalue`; `AppClosed` başında varsa `Exec('{app}\EasyPass.exe', '--quit', ewWaitUntilTerminated)` + 3 sn bekleme, sonra mevcut döngü.
- [ ] **build.yml smoke**: pencere kapatma artık tepsiye iner → `finally` bloğunda `Start-Process publish\EasyPass.exe -ArgumentList '--quit' -Wait` sonra `WaitForExit(10000)`; ikinci koşuda `Tabs` AutomationId'si de aranır.
- [ ] Kabul (Mac, doğrulanacak): `DOTNET_CLI_TELEMETRY_OPTOUT=1 ~/.dotnet/dotnet build src/EasyPass.App -c Release -p:EnableWindowsTargeting=true` → 0 hata. Derlenemiyorsa W3'te VM'de `dotnet build` ilk adım olur.

---

### W2-B — Eklenti + Playwright

**Files:** Create `extension/salyk.js`; Modify `extension/background.js`, `extension/content.js` (tek ekleme), `extension/popup.js`, `extension/popup.html`, `extension/manifest.json` (version 1.6.0 + `content_scripts` ikinci giriş), `extension/test/fake-host.mjs`, `extension/test/sites.mjs`, `extension/test/run.mjs`, `extension/test/e2e-windows.mjs`.

**Consumes:** host protokolü (yukarıda). **Produces:** `fake-host.mjs` aynı şekilleri birebir uygular (host "sözleşme ikizi").

- [ ] **manifest.json**: `{ "matches": ["https://cabinet.salyk.kg/*", "https://salykkabinet.test/*", "http://salykkabinet.localhost/*"], "js": ["salyk.js"], "run_at": "document_idle" }`. Test host'ları yoruma yazılır; başka site yok.
- [ ] **background.js** — `TRACKED = { 'cabinet.salyk.kg': P, 'salykkabinet.test': P, 'salykkabinet.localhost': P }`, `P = { login: '/account/login', select: '/account/selectorganization' }`. Durum `chrome.storage.local` `salyk` anahtarı: `{ entryId, month, at, state: 'attempt'|'open'|'closed', name? }` (login/şifre yok). Kancalar:
  - `submitted()` içinde, **`if (!r.ok || (r.result !== 'changed' && r.result !== 'new')) return null;` satırından ÖNCE**: site takipliyse ve `r.entryId ?? req.entryId` varsa `{state:'attempt', entryId, month: localMonth(), at}` yaz (`same` sonucu bugün burada atılıyor — kanca bu satırın üstünde olmalı). `ambiguous` → takip yok. `add` başarılıysa ve site takipliyse attempt'e `entryId` bağlanır; "Hayır" → takip yok.
  - `salyk_page {path, userName?}` (salyk.js her yüklemede): `login` yolu → state `open` ise `closed` (zaman aşımı/dönüş); `closed` ise `work_get` ile panel verisi döner (`{panel:{...work_get yanıtı}}`); `attempt` 2 dk'yı aştıysa silinir. `select` yolu → attempt varsa ve `userName === username` (work_get'ten) ise `{readName:true}`. Diğer yol → attempt < 2 dk ise `open`.
  - `salyk_name {text}` → yalnız `readName` verilmiş attempt/open için `set_name`. `salyk_logout` (gerçek tık) → `closed`. `work_save {statuses, reminders}` → site/entryId/month oturumdan, host'a; `ok` → oturum silinir. `work_close` → oturum silinir. `summary` → `all/entry` gibi `POPUP_ORIGIN` şartı. `work_*`/`salyk_*` yalnız `TRACKED[site]` varsa; aksi `bad_request`.
- [ ] **salyk.js** (yalnız takipli host; zamanlayıcı yok): yüklenince `send({cmd:'salyk_page', path, userName})`; `document.addEventListener('click', …, true)` ile `e.isTrusted` ve `a[href*="logout"], form[action*="logout"] button` → `salyk_logout`. Seçim sayfasında `SELECT = { row: 'tr', name: 'span.text-gray-800', number: 'span.text-gray-600' }` tek yerde; tek satır → ad; çok satır → `username.startsWith(number)` tam bir tane; ön kabul (≥2 kelime, rakam yok, <100) sonra `salyk_name`. Panel: Shadow DOM, ortada, arka karartma, başlık `name · username` (ad yoksa login), her iş satırı `Сделано`/`Не завершено` toggle; turuncu altında `2 часа · 5 часов · Завтра · Через 2 дня · [ ] часов/дней` (saat = now+N saat; gün = o günün 09:00 yerel → UTC ISO); mevcut hatırlatma varsa saat görünür, `dismissed` ise "напоминание закрыто"; turuncu olup hatırlatması olmayan satır varken `Сохранить` pasif; `Закрыть`/Esc → `work_close`. İş yoksa küçük ipucu "EasyPass'te iş ekleyin". Hata (`locked`, `no_host`, `bad_request`→"EasyPass'i güncelleyin") panelde, durumlar korunur, "yeniden dene". TEXT ru/tr/en; dil `send({cmd:'lang'})`. Panel açılırken `document.dispatchEvent(new CustomEvent('easypass:work-panel', {detail:{open:true}}))`, kapanırken `open:false`.
- [ ] **content.js** tek ekleme: `easypass:work-panel` dinle; `open` iken `close(false)` ve otomatik/tıkla açılmayı engelle (bir bayrak, `open()`/`placeIcons` auto-open dalında kontrol).
- [ ] **popup**: `#summary` satırı üstte, `send({cmd:'summary'})` → "Этот месяц: готово 120 · не завершено 8 · не начато 300"; `search` öğelerindeki `monthStatus` için content.js listesine renkli nokta (`.dot.done/.dot.partial`) — bu content.js'in liste çizimine ikinci küçük dokunuş.
- [ ] **fake-host.mjs**: bellekte `tasks` (`Страховка`, `НДС`, `Отчёт`; `EP_NO_TASKS=1` → boş), `work`, `reminders`; `work_get/work_save/set_name/summary` + `monthStatus` protokol metniyle birebir; `EP_OLD_HOST=1` → yeni komutlara `bad_request` (eski host taklidi).
- [ ] **sites.mjs**: `salykkabinet.test` sitesine `flow:'salyk'`: `GET/POST /account/login` (`Username` `type=number`, hatalı şifre aynı yolda kalır, `?ReturnUrl=`), `GET /account/selectorganization?userName=<login>` (tablo; `span.text-gray-800` ad, `span.text-gray-600` 14 haneli numara, `a.btn-light-primary` "Войти" → `/account/setorganization?organizationId=…`; `?multi=1` iki satır: `93000000000789` ve `93000000000111`), `/`, `/account/logout`, test kancası `GET /__expire` (oturumu düşürür). Kullanıcılar mevcut üç uydurma kayıt; `93000000000789123` çok satır testinin login'i.
- [ ] **run.mjs** senaryoları (her dilde): `salyk: doğru şifre → seçim sayfası adı yazar (set_name) → Войти → oturum açık, panel yok`; `logout tık → sonraki sayfada panel, başlıkta ad · login`; `panel: Сделано + Не завершено → saat zorunlu → Через 2 дня 09:00 → Сохранить → host work_save doğru şekil`; `aynı ay ikinci giriş: durumlar dolu, turuncu→yeşil eski hatırlatmayı kapatır`; `hatalı şifre → panel yok`; `zaman aşımı (/__expire) sonra login → panel`; `sekme kapalı → yeni girişte önceki müşteri için panel`; `çok satırlı seçim: login öneki eşleşen satır alınır`; `iş yok → ipucu`; `eski host → "EasyPass'i güncelleyin"`; `giriş listesinde yeşil/turuncu nokta`; `popup özet satırı`; `takipsiz sitede salyk.js yok ve salyk_* bad_request`; `hız: salyk_page yanıtı < 50 ms (performance.now)`. `e2e-windows.mjs`: salyk sitesine aynı akıştan 3 senaryo (gerçek host ile) eklenir, W3 çalıştırır.
- [ ] Kabul: `cd extension/test && npm install && node run.mjs ru tr en` → tüm `PASS`; `node --check extension/background.js extension/salyk.js extension/content.js extension/popup.js`.

---

### W3 — Windows doğrulama + README + görüntüler

**Files:** `README.md`, `docs/images/**`, `extension/test/app-shots.ps1`, `extension/test/screenshots.mjs`.

- [ ] VM: `prlctl start "Windows 11"`; repo VM'e paylaşımla/`git`siz kopyayla (push yok). `prlctl exec` Parallels Tools ister — yoksa Screen Sharing ile elle (**doğrulanacak**).
- [ ] `dotnet test EasyPass.slnx -c Release` → yeşil. `dotnet publish` (build.yml'deki iki komut) → `publish/`; `iscc installer\EasyPass.iss` → `dist\EasyPass-Setup-1.6.0.exe`; kur.
- [ ] Elle: `EasyPass.exe --background` tepside sessiz; ikinci çalıştırma öne getirir; pencere kapat → tepsi; Çıkış kaydedilmemiş uyarısı; İşler sekmesinde 3 iş ekle; `e2e-windows.mjs --headless` (salyk senaryoları dahil) → yeşil; `Через 2 часа` yerine fake saat için VM saatini ileri al → bildirim penceresi çıkar, kendi kapanmaz, tık → kapanır, yeniden başlatmada çıkmaz; kurucuyu üstüne kur → `--quit` uygulamayı kapatır. v1.5 kasasını (eski sürümden) aç → kayıt kaybı yok.
- [ ] `app-shots.ps1`: üç dilde `Tabs` sekmeleri + bildirim penceresi; `screenshots.mjs` yeni görselleri `docs/images/` adlarıyla kaydeder (gerçek veri yok, demo kasa).
- [ ] README: yeni özellikler, tepsi/`--background`, **sürüm uyumu** (v1.5 yeni alanları siler; iki bilgisayar aynı anda güncellenir), v1.6.0.
- [ ] CI (`windows-latest`) ve GitHub Release: **onay gerekli** (push). Yerel eşdeğeri yukarıdaki VM adımları.

## Spec ile kodun çeliştiği / netleştirilen yerler

1. **§7 adım 1 ↔ `background.js submitted()`**: `same` sonucu bugün `return null` ile atılır ve hiçbir şey saklanmaz; `entryId` yalnız `same`/`changed`'de hazır, `new`'de `add` dönüşünde. Takip kancası bu satırın ÜSTÜNE konur; `ambiguous` takip edilmez (spec sessiz).
2. **§4 "AppRunning adımı arka planda da doğru kapatmalı"**: bugünkü `AppClosed` yalnız WMI ile sorup kullanıcıya kapattırır; tepside pencere yok → `--quit` eklenir. Aynı nedenle `build.yml` smoke'u `CloseMainWindow()` ile çıkış bekler; tepsiyle 10 sn sonra `Stop-Process -Force`'a düşer → `--quit` ile değiştirilir.
3. **§5 "kasa kilitliyse (ana şifreli kasada önbellek yok)"**: kod `Open()`'da ana şifreyi kaldırır; "kilitli" pratikte dosya yok/okunamıyor demektir. Tepsi ipucu metni buna göre ("kasa açılamadı").
4. **§7b `monthStatus`** mevcut `ExtensionContractTests` tam anahtar listesini kırar → W1 bilinçli günceller.
5. **§7 `work_get {site, entryId}`** ay almıyor; §3 ayı giriş anına bağlıyor → `month?` isteğe bağlı eklendi (31'inde giriş, 1'inde panel).
6. **§4 "NotifyIcon SDK içinde"**: doğru ama `UseWindowsForms` csproj'a eklenmeli; `Program.Main()` bugün `args` almıyor.
7. **§11 eski host → `bad_request`**: `HostApi.Handle` allowlist bunu zaten yapar (doğrulandı).

## Riskler

- Hız testleri paylaşımlı CI runner'da oynak; eşikler spec'ten, en iyi 3 ölçüm. `Update` her kayıtta 120 bin `WorkRecord` kopyalar → 300 ms sınırı zorlanırsa Deflate (spec §3) W1 içinde.
- Gerçek sitenin giriş sonrası sayfaları, çıkış bağlantısı ve çok satırlı seçim sayfası görülmedi; sahte site tahmine dayanır. Son söz Uba'nın gerçek denemesinde; `SELECT` sabitleri tek yerde.
- WPF Mac'te derlense bile tepsi, tek örnek, `--background`, bildirim penceresi yalnız Windows'ta görünür → W3'ten W2-A'ya geri dönüş olasılığı yüksek; W2-A'yı bu yüzden opus.
- `chrome.storage.local` oturumu Chrome kapanınca da yaşar (spec ister): günler önceki müşteri için panel çıkabilir; `month` o girişin ayıdır (önceki ay olabilir, host "bu ay/önceki ay" penceresiyle kabul eder).
- v1.5 başka bilgisayarda açılırsa yeni alanlar sessizce silinir (spec bilinçli; README).
- `-p:EnableWindowsTargeting=true` ile net10 WPF+WinForms derlemesi Mac'te doğrulanmadı; `prlctl exec` Parallels Tools gerektirir.
- Panel açıkken `content.js` otomatik açılmayı bastırma iki içerik betiği arasında DOM olayıyla yapılır; sayfa betiği bu olayı taklit edebilir ama yalnız arama panelini kapatır (şifre sızmaz).
