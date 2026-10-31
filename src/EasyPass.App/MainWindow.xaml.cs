using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using EasyPass.Core;
using Microsoft.Win32;
using static EasyPass.App.Loc;

namespace EasyPass.App;

public partial class MainWindow : Window
{
    const int SearchLimit = 500;
    const int MaxRowMarks = 8;      // shortcut: a client with more tasks shows the first 8 in the list row, the detail pane has them all
    const double FormWideMin = 540; // D's three form columns need this much; the 880 window gets two
    // (row, column, span) of the form's fields in XAML order; columns 1 and 3 are the gaps
    static readonly (int Row, int Column, int Span)[] FormWide = [(0, 0, 1), (0, 2, 1), (0, 4, 1), (1, 0, 1), (1, 2, 3), (2, 0, 1), (2, 2, 1), (2, 4, 1)];
    static readonly (int Row, int Column, int Span)[] FormNarrow = [(0, 0, 1), (0, 2, 1), (1, 0, 1), (1, 2, 1), (2, 0, 3), (3, 0, 1), (3, 2, 1), (4, 0, 3)];
    // tr-TR: Türkçe harfleri doğru sıralar, Kiril adlar da doğal sırada kalır
    static readonly StringComparer NameOrder = StringComparer.Create(CultureInfo.GetCultureInfo("tr-TR"), true);

    Vault? vault;
    string? editingId;      // null = yeni kayıt
    Entry? loaded;          // forma doldurulan kayıt; kasa kayıtları yerinde değişmez, her okuma/kayıt yeni nesne verir
    bool refreshing;        // liste kodla yenilenirken seçim olayını yok say
    bool asking;            // soru kutusu açıkken arka plan yenilemesi beklesin
    bool passwordShown;
    string lastSite = "";   // yeni müşteri bu siteyle başlar (hızlı giriş)
    bool quitting;          // false: pencereyi kapatmak tepsiye indirir
    bool reloading;         // arka planda yeniden okuma sürüyor
    bool screenStale;       // yeni veri okundu, ekran soru kutusu kapanınca güncellenecek
    // arka plandaki yeniden okuma ile yazma aynı anda çalışmasın: geç biten okuma, yazmanın kopyaladığı veriyi eskisiyle değiştirirdi
    readonly object vaultGate = new();
    readonly TrayIcon tray;
    readonly ReminderService reminders;
    readonly DrawerWindow drawer;
    Dictionary<string, Dictionary<string, string>> monthWork = []; // this month's statuses by client, for the list rows
    bool formWide = true;

    public MainWindow()
    {
        InitializeComponent();
        ((EntryMarksConverter)Resources["EntryMarks"]).Marks = MarksOf;
        TodoPage.Main = this;
        NotificationsPage.Main = this;
        TasksPage.Main = this;
        WorkPage.Main = this;
        tray = new TrayIcon(this);
        Application.Current.Exit += (_, _) => tray.Dispose();
        reminders = new ReminderService(this, tray);
        drawer = new DrawerWindow(this);
        IsVisibleChanged += (_, _) => RefreshTab(); // gizliyken ekran hesaplanmaz, açılınca yetişir
        // eklentinin yazdığı kayıtlar pencere odakta olmasa da görünsün; yalnız dosya tarihi/boyutu bakılır
        new DispatcherTimer(TimeSpan.FromSeconds(2), DispatcherPriority.Background, (_, _) => ReloadFromDisk(), Dispatcher).Start();
        Start();
        reminders.Check();
    }

    internal Vault? ActiveVault => vault;
    internal bool IsQuitting => quitting;

    Entry? Current => vault?.Entries.FirstOrDefault(e => e.Id == editingId);

    // --- Akış: Kurulum / Kilit / Ana ekran ---

    void Start()
    {
        var path = AppPaths.VaultPath;
        if (path != null && !File.Exists(path) && (File.Exists(path + ".bak") || File.Exists(path + ".tmp")))
        {
            // yarım kalmış kayıt ya da bitmemiş bulut eşitlemesi: yedeğin üstüne yeni kasa önerme
            ShowSetup(cancelable: false);
            SetupError.Text = string.Format(L("ErrVaultMissing"), path);
            return;
        }
        if (path == null || !File.Exists(path)) { ShowSetup(cancelable: false); return; }
        try
        {
            // şifresiz kasa (format sonrası da) doğrudan açılır; eski şifreli kasa için bu bilgisayardaki anahtar önbelleği
            var key = KeyCache.Load(Vault.ReadSalt(path)) ?? Vault.PasswordlessKey(path);
            if (key != null) { Open(Vault.Open(path, key), resetForm: true); return; }
        }
        catch (Exception) { } // önbellek eski ya da dosya okunamadı: ana şifre sorulur, hata orada görünür
        ShowLock(path, "");
    }

    void ShowPanel(UIElement panel)
    {
        foreach (var p in new UIElement[] { SetupPanel, LockPanel, MainPanel })
            p.Visibility = p == panel ? Visibility.Visible : Visibility.Collapsed;
    }

    void ShowSetup(bool cancelable)
    {
        SetupError.Text = "";
        OpenPassword.Clear();
        SetupCancel.Visibility = cancelable ? Visibility.Visible : Visibility.Collapsed;
        ShowPanel(SetupPanel);
    }

    void ShowLock(string path, string error)
    {
        LockPath.Text = path;
        LockError.Text = error;
        LockPassword.Clear();
        ShowPanel(LockPanel);
        LockPassword.Focus();
    }

    void Open(Vault v, bool resetForm)
    {
        vault = v;
        AppPaths.VaultPath = v.Path;
        // kasalar artık ana şifresiz (unutulunca hepsi kaybolmasın): eski şifreli kasanın şifresi kaldırılır,
        // önceki şifreli hâli .bak olarak kalır
        var hadPassword = v.HasPassword;
        string? removeError = null;
        if (hadPassword)
        {
            try { v.ChangePassword(""); }
            catch (Exception ex) { removeError = ex.Message; } // kasa açık kalır, sonraki açılışta yeniden denenir
        }
        KeyCache.Save(v.Salt, v.Key);
        ShowPanel(MainPanel);
        drawer.Available = true;
        if (resetForm) { lastSite = ""; SearchBox.Text = ""; Edit(null); }
        RefreshTab();
        if (removeError != null) SetStatus(L("ErrRemovePassword") + removeError, error: true);
        else if (hadPassword) SetStatus(L("PasswordRemoved"));
        SearchBox.Focus();
        reminders.Check();
    }

    // Başka bilgisayar kasayı yeniden şifreledi (ör. ana şifresini kaldırdı): şifresizse sessizce yeniden açılır.
    bool ReopenPasswordless(bool keepForm)
    {
        try
        {
            if (vault == null || Vault.PasswordlessKey(vault.Path) is not { } key) return false;
            Open(Vault.Open(vault.Path, key), resetForm: !keepForm);
            return true;
        }
        catch (Exception) { return false; }
    }

    void Lock(string error = "")
    {
        var path = vault?.Path ?? AppPaths.VaultPath ?? "";
        KeyCache.Clear();
        vault = null;
        drawer.Available = false;
        editingId = null;
        FillForm(null);
        EntryList.ItemsSource = null;
        ShowHistory();
        reminders.Check();
        ShowLock(path, error);
    }

    // PBKDF2 (600 000 tur) arayüzü dondurmasın diye arka planda
    async Task<bool> Run(Action work, TextBlock error)
    {
        error.Text = "";
        IsEnabled = false;
        Mouse.OverrideCursor = Cursors.Wait;
        try { await Task.Run(work); return true; }
        catch (CryptographicException) { error.Text = L("ErrWrongPassword"); }
        catch (InvalidDataException) { error.Text = L("ErrNotVault"); }
        catch (Exception ex) { error.Text = L("ErrFailed") + ex.Message; }
        finally { IsEnabled = true; Mouse.OverrideCursor = null; }
        return false;
    }

    internal MessageBoxResult Ask(string text, string caption, MessageBoxButton buttons, MessageBoxImage image, MessageBoxResult defaultResult = MessageBoxResult.None)
    {
        asking = true;
        try { return MessageBox.Show(this, text, caption, buttons, image, defaultResult); }
        finally { asking = false; }
    }

    // --- Kurulum ---

    void PickNewPath_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SaveFileDialog { Title = L("DlgNewTitle"), FileName = "vault.ezp", Filter = L("DlgFilter"), OverwritePrompt = false };
        if (dialog.ShowDialog(this) == true) NewPathBox.Text = dialog.FileName;
    }

    void PickOpenPath_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFileDialog { Title = L("DlgOpenTitle"), Filter = L("DlgFilterAll") };
        if (dialog.ShowDialog(this) == true) OpenPathBox.Text = dialog.FileName;
    }

    async void CreateVault_Click(object sender, RoutedEventArgs e)
    {
        var path = NewPathBox.Text;
        SetupError.Text =
            path == "" ? L("ErrPickLocation") :
            File.Exists(path) || File.Exists(path + ".bak") || File.Exists(path + ".tmp") ? L("ErrFileExists") : "";
        if (SetupError.Text != "") return;

        Vault? created = null;
        if (await Run(() => created = Vault.Create(path), SetupError)) Open(created!, resetForm: true);
    }

    async void OpenVault_Click(object sender, RoutedEventArgs e)
    {
        var path = OpenPathBox.Text;
        var password = OpenPassword.Password;
        if (path == "") { SetupError.Text = L("ErrPickFile"); return; }
        byte[]? key;
        try { key = Vault.PasswordlessKey(path); }
        catch (Exception ex) when (ex is IOException or InvalidDataException or UnauthorizedAccessException) { SetupError.Text = L("ErrNotVault"); return; }
        // şifre yalnız eski, şifreli kasada gerekir (bir kez; açılınca kaldırılır)
        if (key == null && password == "") { SetupError.Text = L("ErrNeedOldMaster"); return; }

        Vault? opened = null;
        if (await Run(() => opened = key != null ? Vault.Open(path, key) : Vault.Open(path, password), SetupError)) Open(opened!, resetForm: true);
    }

    void SetupCancel_Click(object sender, RoutedEventArgs e) => ShowPanel(MainPanel);

    // --- Kilit ---

    async void Unlock_Click(object sender, RoutedEventArgs e)
    {
        var path = LockPath.Text;
        var password = LockPassword.Password;
        if (password == "") { LockError.Text = L("ErrEnterMaster"); return; }

        Vault? opened = null;
        if (await Run(() => opened = Vault.Open(path, password), LockError)) Open(opened!, resetForm: true);
        else { LockPassword.Clear(); LockPassword.Focus(); }
    }

    void LockPassword_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) Unlock_Click(sender, e);
    }

    // --- Ana ekran ---

    void Window_Activated(object? sender, EventArgs e) => ReloadFromDisk();

    bool ReloadBlocked => MainPanel.Visibility != Visibility.Visible || !IsEnabled || asking || OwnedWindows.Count > 0;

    async void ReloadFromDisk()
    {
        if (vault is not { } v || reloading || ReloadBlocked) return;
        reloading = true;
        try
        {
            // 15-20 MB kasada okuma ~300 ms sürer: arayüz donmasın
            if (await Task.Run(() => { lock (vaultGate) return v.ReloadIfChanged(); })) screenStale = true;
            if (vault != v || !screenStale || ReloadBlocked) return;
            screenStale = false;
            if (IsDirty()) ShowHistory(); // değişiklik kullanıcınınsa formu ezme
            else Edit(editingId);
            RefreshTab();
            reminders.Check();
            drawer.Reload();
        }
        catch (VaultPasswordChangedException)
        {
            if (vault != v) return;
            var dirty = Unsaved;
            if (ReopenPasswordless(keepForm: dirty)) return;
            // ana şifre başka bilgisayarda değişti; formda yazılmamış veri varsa kilitleyip silme
            if (dirty) SetStatus(L("ErrKeyChangedDirty"), error: true);
            else Lock(L("ErrKeyChanged"));
        }
        catch (Exception ex) when (ex is CryptographicException or InvalidDataException)
        {
            // yarım yazılmış/eşitlenen dosya: anahtar önbelleği kalır (eklenti çalışmaya devam eder), sonraki tik yeniden dener
            SetStatus(L("ErrReload") + L("ErrUnreadable"), error: true);
        }
        catch (Exception ex) { SetStatus(L("ErrReload") + ex.Message, error: true); }
        finally { reloading = false; }
    }

    void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (quitting) return;
        e.Cancel = true;
        if (!IsEnabled || !ConfirmLeave()) return; // !IsEnabled: kasa işi arka planda sürüyor
        if (vault != null) Edit(editingId); // "Kaydetme" denildi: gizli formda eski değişiklik kalmasın
        Hide();
    }

    // --- Tepsi ve çıkış ---

    internal void ShowFromTray()
    {
        Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }

    /// <summary>Asks about unsaved changes, in view. True: the app may end now.</summary>
    internal bool ReadyToLeave()
    {
        if (asking || !IsEnabled) { ShowFromTray(); return false; }
        if (vault != null && Unsaved) ShowFromTray();
        if (!ConfirmLeave()) return false;
        quitting = true;
        return true;
    }

    internal void Quit()
    {
        if (ReadyToLeave()) Application.Current.Shutdown();
    }

    internal void ShowNotifications()
    {
        ShowFromTray();
        Tabs.SelectedIndex = 2;
    }

    internal void ShowDueCount(int count)
    {
        var changed = DueCount.Text != count.ToString();
        DueCount.Text = count.ToString();
        if (changed && IsVisible && Tabs.SelectedIndex == 2) NotificationsPage.Refresh(); // saati gelen satır "Planlandı"dan çıksın
        DueBadge.Visibility = count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    // --- Sekmeler ---

    void Tabs_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (e.OriginalSource == Tabs) RefreshTab(); // içerideki listelerin seçim olayı da buraya kadar gelir
    }

    /// <summary>Only the tab in view is worked out; the others catch up when opened.</summary>
    void RefreshTab()
    {
        if (vault == null || !IsVisible) return;
        switch (Tabs.SelectedIndex)
        {
            case 0: RefreshList(); break;
            case 1: TodoPage.Refresh(); break;
            case 2: NotificationsPage.Refresh(); break;
            case 3: TasksPage.Refresh(); break;
        }
    }

    internal void OpenEntry(string id)
    {
        if (!ConfirmLeave()) return;
        Tabs.SelectedIndex = 0;
        SearchBox.Text = "";
        Edit(id);
        RefreshList();
        if (EntryList.SelectedItem is { } item) EntryList.ScrollIntoView(item);
    }

    /// <summary>Changes outside the form (tasks, reminders, the to-do list). False: not saved, the user was told.</summary>
    internal bool Write(Action<VaultData> change)
    {
        if (vault == null) return false;
        try { lock (vaultGate) vault.Update(change); }
        catch (VaultPasswordChangedException) when (ReopenPasswordless(keepForm: true)) { return Write(change); } // şifresi başka yerde kaldırıldı
        catch (VaultPasswordChangedException) { return WriteFailed(L("ErrKeyChangedDirty")); }
        catch (Exception ex) when (ex is CryptographicException or InvalidDataException) { return WriteFailed(L("ErrSave") + L("ErrUnreadable")); }
        catch (Exception ex) { return WriteFailed(L("ErrSave") + ex.Message); }
        ShowHistory();
        RefreshTab();
        reminders.Check();
        return true;
    }

    bool WriteFailed(string message)
    {
        Ask(message, L("ErrTitle"), MessageBoxButton.OK, MessageBoxImage.Error);
        return false;
    }

    void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => RefreshList();

    void RefreshList()
    {
        if (vault == null || !IsVisible || Tabs.SelectedIndex != 0) return;
        var query = SearchBox.Text;
        var items = string.IsNullOrWhiteSpace(query)
            ? vault.Entries.OrderBy(x => x.Site, StringComparer.Ordinal).ThenBy(x => x.FirstName, NameOrder).ThenBy(x => x.LastName, NameOrder).ToList()
            : vault.Search(query, SearchLimit).ToList();
        var month = Work.MonthOf(DateTime.Now);
        MonthText.Text = MonthName(month);
        monthWork = [];
        foreach (var w in vault.Data.Work)
            if (w.Month == month) monthWork.TryAdd(w.EntryId, w.Tasks);
        refreshing = true;
        EntryList.ItemsSource = items;
        EntryList.SelectedItem = items.FirstOrDefault(x => x.Id == editingId);
        refreshing = false;
        var sites = vault.Entries.Select(x => x.Site).Where(x => x != "").Distinct().Order(StringComparer.Ordinal).ToList();
        if (SiteBox.ItemsSource is not List<string> old || !old.SequenceEqual(sites))
        {
            var typed = SiteBox.Text; // öğe listesi değişince yazılmış metin kaybolmasın
            SiteBox.ItemsSource = sites;
            SiteBox.Text = typed;
        }
        CountText.Text = string.Format(L(string.IsNullOrWhiteSpace(query) ? "CountAll" : "CountFound"),
            string.IsNullOrWhiteSpace(query) ? vault.Entries.Count : items.Count);
    }

    // A row's marks are worked out when the row is realized; the list is virtualized, so only the rows in view pay for it
    IReadOnlyList<RowMark> MarksOf(Entry entry)
    {
        if (vault == null) return [];
        var statuses = monthWork.GetValueOrDefault(entry.Id);
        return [.. Work.TasksOf(vault.Data, entry).Take(MaxRowMarks).Select(t =>
        {
            var (glyph, state) = statuses?.GetValueOrDefault(t.Id) switch
            {
                Work.Done => ("GlyphDone", "TodoDone"),
                Work.Partial => ("GlyphPartial", "TodoUnfinished"),
                _ => ("GlyphNone", "TodoNotStarted"),
            };
            return new RowMark((ImageSource)FindResource(glyph), $"{t.Name}: {L(state)}");
        })];
    }

    void FormGrid_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        var wide = e.NewSize.Width >= FormWideMin;
        if (wide == formWide) return;
        formWide = wide;
        FormGrid.ColumnDefinitions[3].Width = wide ? new GridLength(14) : new GridLength(0);
        FormGrid.ColumnDefinitions[4].Width = wide ? new GridLength(1, GridUnitType.Star) : new GridLength(0);
        var places = wide ? FormWide : FormNarrow;
        for (var i = 0; i < places.Length; i++)
        {
            var field = FormGrid.Children[i];
            Grid.SetRow(field, places[i].Row);
            Grid.SetColumn(field, places[i].Column);
            Grid.SetColumnSpan(field, places[i].Span);
        }
    }

    void EntryList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (refreshing || EntryList.SelectedItem is not Entry picked || picked.Id == editingId) return;
        if (ConfirmLeave()) Edit(picked.Id); // listeyi yeniden kurmaz: veri değişmedi, kaydırma yerinde kalsın
        else RefreshList(); // seçimi düzenlenen kayda geri al
    }

    void NewEntry_Click(object sender, RoutedEventArgs e)
    {
        if (!ConfirmLeave()) return;
        Edit(null);
        RefreshList();
        FirstNameBox.Focus();
    }

    void Edit(string? id)
    {
        if (id != editingId) EditScroll.ScrollToTop();
        editingId = id;
        if (Current == null) editingId = null; // başka yerde silinmiş olabilir
        FillForm(Current);
        if (Current is Entry current) lastSite = current.Site;
        else SiteBox.Text = lastSite;
        SiteError.Text = "";
        ShowHead(Current);
        DeleteButton.IsEnabled = editingId != null;
        SetStatus("");
        ShowHistory();
    }

    // D's head: who is open, or "New client"
    void ShowHead(Entry? entry)
    {
        var name = entry == null ? "" : entry.FullName != "" ? entry.FullName : entry.Username;
        if (name != "") EditTitle.Text = name;
        else EditTitle.SetResourceReference(TextBlock.TextProperty, entry == null ? "NewEntry" : "EditTitleEdit");
        EditLogin.Text = entry?.Username ?? "";
        EditSite.Text = entry?.Site ?? "";
        EditSub.Visibility = entry == null ? Visibility.Collapsed : Visibility.Visible;
    }

    void ShowHistory()
    {
        List<MonthMarks> rows = vault == null || editingId == null ? [] : vault.Data.Work
            .Where(w => w.EntryId == editingId)
            .OrderByDescending(w => w.Month, StringComparer.Ordinal)
            .Select(w => MonthMarks.Of(vault.Data.Tasks, MonthName(w.Month), w.Tasks))
            .OfType<MonthMarks>()
            .ToList();
        HistoryList.ItemsSource = rows;
        WorkPage.Refresh(vault, editingId);
        HistoryPanel.Visibility = rows.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    void FillForm(Entry? entry)
    {
        loaded = entry;
        SiteBox.Text = entry?.Site ?? "";
        FirstNameBox.Text = entry?.FirstName ?? "";
        LastNameBox.Text = entry?.LastName ?? "";
        Extra1Box.Text = entry?.Extra1 ?? "";
        Extra2Box.Text = entry?.Extra2 ?? "";
        UsernameBox.Text = entry?.Username ?? "";
        PasswordBox.Password = PasswordText.Text = entry?.Password ?? "";
        ShowSiteFields(entry?.Fields ?? []);
    }

    // Sitenin kayıt formundan gelen bilgiler, salt okunur: gizli olanlar "Göster"e basılana kadar nokta
    void ShowSiteFields(List<EntryField> fields)
    {
        SiteFieldsList.Children.Clear();
        SiteFieldsPanel.Visibility = fields.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        foreach (var f in fields)
        {
            SiteFieldsList.Children.Add(new TextBlock { Text = f.Label == "" ? "—" : f.Label, Style = (Style)FindResource("Label") });
            var value = new TextBox { IsReadOnly = true, Text = f.Secret ? Mask(f.Value) : f.Value };
            var row = new DockPanel();
            if (f.Secret)
            {
                var show = new Button { Margin = new Thickness(8, 0, 0, 0) };
                show.SetResourceReference(ContentProperty, "Show");
                var shown = false;
                show.Click += (_, _) =>
                {
                    shown = !shown;
                    value.Text = shown ? f.Value : Mask(f.Value);
                    show.SetResourceReference(ContentProperty, shown ? "Hide" : "Show");
                };
                DockPanel.SetDock(show, Dock.Right);
                row.Children.Add(show);
            }
            row.Children.Add(value);
            SiteFieldsList.Children.Add(row);
        }
    }

    static string Mask(string value) => new('•', Math.Min(value.Length, 12));

    string FormPassword => passwordShown ? PasswordText.Text : PasswordBox.Password;

    bool IsDirty()
    {
        var e = loaded; // Current değil: arka planda gelen değişiklik kullanıcının değişikliği sayılmasın
        return (e != null && SiteBox.Text != e.Site) // yeni kayıtta önceden doldurulan site değişiklik sayılmaz
            || FirstNameBox.Text != (e?.FirstName ?? "") || LastNameBox.Text != (e?.LastName ?? "")
            || Extra1Box.Text != (e?.Extra1 ?? "") || Extra2Box.Text != (e?.Extra2 ?? "")
            || UsernameBox.Text != (e?.Username ?? "") || FormPassword != (e?.Password ?? "");
    }

    bool Unsaved => IsDirty() || WorkPage.IsDirty; // form ya da bu ayın iş düğmeleri

    /// <summary>Kaydedilmemiş değişiklik varsa sorar. Devam edilebilirse true.</summary>
    bool ConfirmLeave()
    {
        if (vault == null || !Unsaved) return true;
        var answer = Ask(L("AskSaveChanges"), "EasyPass", MessageBoxButton.YesNoCancel, MessageBoxImage.Question);
        if (answer == MessageBoxResult.No) WorkPage.Discard();
        return answer == MessageBoxResult.No || (answer == MessageBoxResult.Yes && (!IsDirty() || Save()) && WorkPage.Save());
    }

    void Save_Click(object sender, RoutedEventArgs e) => Save();

    bool Save()
    {
        if (vault == null) return false;
        var site = Sites.Normalize(SiteBox.Text);
        // yalnız "com" gibi bir ad her .com sitesiyle eşleşirdi (spec §3a): gerçek bir host adı iste
        var validSite = site.Contains('.') && Uri.CheckHostName(site) is UriHostNameType.Dns or UriHostNameType.IPv4;
        SiteError.Text = site == "" ? L("ErrNeedSite") : !validSite ? L("ErrBadSite") : "";
        if (SiteError.Text != "") { SiteBox.Focus(); return false; }
        var first = FirstNameBox.Text.Trim();
        var last = LastNameBox.Text.Trim();
        var extra1 = Extra1Box.Text.Trim();
        var extra2 = Extra2Box.Text.Trim();
        var username = UsernameBox.Text.Trim();
        var password = FormPassword;
        // eklentinin adsız eklediği kayıt da düzenlenebilsin: ad yalnız yeni kayıtta zorunlu
        if (editingId == null && first == "" && last == "") { SetStatus(L("ErrNeedName"), error: true); return false; }
        if (username == "") { SetStatus(L("ErrNeedUsername"), error: true); return false; }
        if (password == "") { SetStatus(L("ErrNeedPassword"), error: true); return false; }

        var id = editingId ?? Guid.NewGuid().ToString("N");
        var was = loaded;
        var form = (site: SiteBox.Text, first: FirstNameBox.Text, last: LastNameBox.Text, extra1: Extra1Box.Text,
            extra2: Extra2Box.Text, username: UsernameBox.Text, password);
        try
        {
            lock (vaultGate) vault.Update(list =>
            {
                var index = list.FindIndex(x => x.Id == id);
                var now = index < 0 ? null : list[index];
                // yalnız kullanıcının değiştirdiği alan yazılır; dokunulmayan alan diskteki güncel değeri korur
                // (form açıkken eklenti şifreyi güncellemiş ya da başka bilgisayar değiştirmiş olabilir)
                string Pick(string box, Func<Entry, string> field, string value) =>
                    was != null && now != null && box == field(was) ? field(now) : value;
                // yerinde değiştirme yok: kayıt başarısız olursa bellekteki kasa eski hâliyle kalsın
                var entry = new Entry
                {
                    Id = id,
                    Site = Pick(form.site, e => e.Site, site),
                    FirstName = Pick(form.first, e => e.FirstName, first),
                    LastName = Pick(form.last, e => e.LastName, last),
                    Extra1 = Pick(form.extra1, e => e.Extra1, extra1),
                    Extra2 = Pick(form.extra2, e => e.Extra2, extra2),
                    Username = Pick(form.username, e => e.Username, username),
                    Password = Pick(form.password, e => e.Password, password),
                    Fields = now?.Fields ?? was?.Fields ?? [], // sitedeki bilgiler formda düzenlenmez: olduğu gibi kalır
                    TodoHidden = now?.TodoHidden ?? false,
                    TaskIds = now?.TaskIds ?? was?.TaskIds, // the list of work is not on the form: it stays as it is
                };
                if (index < 0) list.Add(entry); // yeni ya da bu arada başka yerde silinmiş
                else list[index] = entry;
            });
        }
        catch (VaultPasswordChangedException) when (ReopenPasswordless(keepForm: true)) { return Save(); } // şifresi başka yerde kaldırıldı
        catch (VaultPasswordChangedException) { SetStatus(L("ErrKeyChangedDirty"), error: true); return false; }
        catch (Exception ex) when (ex is CryptographicException or InvalidDataException) { SetStatus(L("ErrSave") + L("ErrUnreadable"), error: true); return false; }
        catch (Exception ex) { SetStatus(L("ErrSave") + ex.Message, error: true); return false; }

        Edit(id);
        RefreshList();
        SetStatus(L("Saved"));
        return true;
    }

    void Delete_Click(object sender, RoutedEventArgs e)
    {
        if (vault == null || Current is not Entry entry) return;
        var answer = Ask(string.Format(L("AskDelete"), entry.FullName, $"{entry.Username}, {entry.Site}"), L("DeleteTitle"),
            MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
        if (answer != MessageBoxResult.Yes) return;
        var id = entry.Id;
        try { lock (vaultGate) vault.Update(d => Work.RemoveEntry(d, id)); }
        catch (Exception ex) { SetStatus(L("ErrDelete") + ex.Message, error: true); return; }
        Edit(null);
        RefreshList();
        reminders.Check(); // silinen müşterinin bildirimi ekranda kalmasın
        SetStatus(L("Deleted"));
    }

    void TogglePassword_Click(object sender, RoutedEventArgs e)
    {
        if (passwordShown) PasswordBox.Password = PasswordText.Text;
        else PasswordText.Text = PasswordBox.Password;
        passwordShown = !passwordShown;
        PasswordText.Visibility = passwordShown ? Visibility.Visible : Visibility.Collapsed;
        PasswordBox.Visibility = passwordShown ? Visibility.Collapsed : Visibility.Visible;
        ShowPasswordButton.SetResourceReference(ContentProperty, passwordShown ? "Hide" : "Show");
    }

    void CopyPassword_Click(object sender, RoutedEventArgs e)
    {
        var password = FormPassword;
        if (password == "") return;
        try
        {
            var data = new DataObject(DataFormats.UnicodeText, password);
            // Win+V geçmişine ve bulut panosuna gitmesin
            data.SetData("ExcludeClipboardContentFromMonitorProcessing", new MemoryStream(new byte[4]));
            Clipboard.SetDataObject(data, copy: true);
            SetStatus(L("Copied"));
        }
        catch (Exception) { SetStatus(L("ErrClipboard"), error: true); return; }
        var timer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            // kullanıcı bu arada başka bir şey kopyaladıysa ona dokunma
            try { if (Clipboard.ContainsText() && Clipboard.GetText() == password) Clipboard.Clear(); }
            catch (Exception) { } // pano meşgul: bırak
        };
        timer.Start();
    }

    void SetStatus(string text, bool error = false)
    {
        StatusText.Text = text;
        StatusText.Foreground = (Brush)FindResource(error ? "DangerBrush" : "TextSecondaryBrush");
    }

    // --- Ayarlar ---

    void Settings_Click(object sender, RoutedEventArgs e)
    {
        if (vault == null) return;
        var lang = AppPaths.Lang;
        var settings = new SettingsWindow(vault) { Owner = this };
        settings.ShowDialog();
        RefreshTab(); // dil değiştiyse koddan yazılan metinler de yenilensin
        ShowHistory();
        reminders.Check();
        if (AppPaths.Lang != lang) SetStatus(""); // koddan yazılmış durum metni eski dilde kalmasın
        switch (settings.Choice)
        {
            case SettingsChoice.OpenOther when ConfirmLeave():
                OpenPathBox.Text = ""; NewPathBox.Text = "";
                ShowSetup(cancelable: true);
                break;
        }
    }
}

// Public: WPF bindings do not see internal types.
public sealed record RowMark(ImageSource Glyph, string Name);

public sealed class EntryMarksConverter : IValueConverter
{
    internal Func<Entry, IReadOnlyList<RowMark>>? Marks;

    public object? Convert(object value, Type targetType, object parameter, CultureInfo culture) =>
        value is Entry entry ? Marks?.Invoke(entry) : null;

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture) => throw new NotSupportedException();
}
