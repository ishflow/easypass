using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using EasyPass.Core;
using Microsoft.Win32;
using static EasyPass.App.Loc;

namespace EasyPass.App;

public enum SettingsChoice { None, OpenOther }

public partial class SettingsWindow : Window
{
    readonly string extensionDir = Path.Combine(AppContext.BaseDirectory, "extension");

    public SettingsChoice Choice { get; private set; }

    public SettingsWindow(Vault vault)
    {
        InitializeComponent();
        VaultPathBox.Text = vault.Path;
        ExtensionPathBox.Text = extensionDir;
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Google\Chrome\NativeMessagingHosts\com.easypass.host");
        ChromeStatus.SetResourceReference(TextBlock.TextProperty, key != null ? "ChromeOk" : "ChromeMissing");
        ChromeStatus.Foreground = (Brush)FindResource(key != null ? "AccentBrush" : "DangerBrush");
        MarkLanguage(AppPaths.Lang);
    }

    void Language_Click(object sender, RoutedEventArgs e)
    {
        var lang = sender == TurkishButton ? "tr" : "ru";
        AppPaths.Lang = lang;
        Loc.Apply(lang);
        MarkLanguage(lang);
    }

    void MarkLanguage(string lang)
    {
        RussianButton.Style = (Style)FindResource(lang == "tr" ? typeof(Button) : "AccentButton");
        TurkishButton.Style = (Style)FindResource(lang == "tr" ? "AccentButton" : typeof(Button));
    }

    void OpenOther_Click(object sender, RoutedEventArgs e) { Choice = SettingsChoice.OpenOther; Close(); }

    void OpenExtensionFolder_Click(object sender, RoutedEventArgs e)
    {
        if (Directory.Exists(extensionDir)) Process.Start("explorer.exe", extensionDir);
        else MessageBox.Show(this, L("ExtMissing"), "EasyPass", MessageBoxButton.OK, MessageBoxImage.Information);
    }
}
