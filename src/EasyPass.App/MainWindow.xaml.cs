using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Controls;
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
    // tr-TR: Türkçe harfleri doğru sıralar, Kiril adlar da doğal sırada kalır
    static readonly StringComparer NameOrder = StringComparer.Create(CultureInfo.GetCultureInfo("tr-TR"), true);

    Vault? vault;
    string? editingId;      // null = yeni kayıt
    Entry? loaded;          // forma doldurulan kayıt; kasa kayıtları yerinde değişmez, her okuma/kayıt yeni nesne verir
    bool refreshing;        // liste kodla yenilenirken seçim olayını yok say
    bool asking;            // soru kutusu açıkken arka plan yenilemesi beklesin
    bool passwordShown;
    string lastSite = "";   // yeni müşteri bu siteyle başlar (hızlı giriş)

    public MainWindow()
    {
        InitializeComponent();
        // eklentinin yazdığı kayıtlar pencere odakta olmasa da görünsün; yalnız dosya tarihi/boyutu bakılır
        new DispatcherTimer(TimeSpan.FromSeconds(2), DispatcherPriority.Background, (_, _) => ReloadFromDisk(), Dispatcher).Start();
        Start();
    }

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
        if (resetForm) { lastSite = ""; SearchBox.Text = ""; Edit(null); }
        RefreshList();
        if (removeError != null) SetStatus(L("ErrRemovePassword") + removeError, error: true);
        else if (hadPassword) SetStatus(L("PasswordRemoved"));
        SearchBox.Focus();
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
        editingId = null;
        FillForm(null);
        EntryList.ItemsSource = null;
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

    MessageBoxResult Ask(string text, string caption, MessageBoxButton buttons, MessageBoxImage image, MessageBoxResult defaultResult = MessageBoxResult.None)
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

    void ReloadFromDisk()
    {
        if (vault == null || MainPanel.Visibility != Visibility.Visible || !IsEnabled || asking || OwnedWindows.Count > 0) return;
        var dirty = IsDirty(); // yeniden okumadan önce: değişiklik kullanıcınınsa formu ezme
        try
        {
            if (!vault.ReloadIfChanged()) return;
            if (!dirty) Edit(editingId);
            RefreshList();
        }
        catch (VaultPasswordChangedException)
        {
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
    }

    void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (!IsEnabled || !ConfirmLeave()) e.Cancel = true; // !IsEnabled: kasa işi arka planda sürüyor
    }

    void SearchBox_TextChanged(object sender, TextChangedEventArgs e) => RefreshList();

    void RefreshList()
    {
        if (vault == null) return;
        var query = SearchBox.Text;
        var items = string.IsNullOrWhiteSpace(query)
            ? vault.Entries.OrderBy(x => x.Site, StringComparer.Ordinal).ThenBy(x => x.FirstName, NameOrder).ThenBy(x => x.LastName, NameOrder).ToList()
            : vault.Search(query, SearchLimit).ToList();
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
        editingId = id;
        if (Current == null) editingId = null; // başka yerde silinmiş olabilir
        FillForm(Current);
        if (Current is Entry current) lastSite = current.Site;
        else SiteBox.Text = lastSite;
        SiteError.Text = "";
        EditTitle.SetResourceReference(TextBlock.TextProperty, editingId == null ? "NewEntry" : "EditTitleEdit");
        DeleteButton.IsEnabled = editingId != null;
        SetStatus("");
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

    /// <summary>Kaydedilmemiş değişiklik varsa sorar. Devam edilebilirse true.</summary>
    bool ConfirmLeave()
    {
        if (vault == null || !IsDirty()) return true;
        var answer = Ask(L("AskSaveChanges"), "EasyPass", MessageBoxButton.YesNoCancel, MessageBoxImage.Question);
        return answer == MessageBoxResult.No || (answer == MessageBoxResult.Yes && Save());
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
            vault.Update(list =>
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
        try { vault.Update(list => list.RemoveAll(x => x.Id == id)); }
        catch (Exception ex) { SetStatus(L("ErrDelete") + ex.Message, error: true); return; }
        Edit(null);
        RefreshList();
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
        RefreshList(); // dil değiştiyse sayaç metni de yenilensin
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
