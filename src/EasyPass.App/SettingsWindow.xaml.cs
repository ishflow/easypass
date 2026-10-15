using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using EasyPass.Core;
using Microsoft.Win32;
using static EasyPass.App.Loc;

namespace EasyPass.App;

public enum SettingsChoice { None, OpenOther, Lock }

public partial class SettingsWindow : Window
{
    readonly Vault vault;
    readonly string extensionDir = Path.Combine(AppContext.BaseDirectory, "extension");

    public SettingsChoice Choice { get; private set; }

    public SettingsWindow(Vault vault)
    {
        this.vault = vault;
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

    void Lock_Click(object sender, RoutedEventArgs e) { Choice = SettingsChoice.Lock; Close(); }

    async void ChangePassword_Click(object sender, RoutedEventArgs e)
    {
        var oldPassword = OldPassword.Password;
        var newPassword = NewPassword1.Password;
        ShowMessage(
            oldPassword == "" ? L("ErrEnterCurrent") :
            newPassword.Length < 8 ? L("ErrShortPassword") :
            newPassword != NewPassword2.Password ? L("ErrMismatch") : "", error: true);
        if (PasswordMessage.Text != "") return;

        IsEnabled = false;
        Mouse.OverrideCursor = Cursors.Wait;
        try
        {
            await Task.Run(() =>
            {
                Vault.Open(vault.Path, oldPassword); // eski şifreyi doğrula
                vault.ChangePassword(newPassword);
            });
            KeyCache.Save(vault.Salt, vault.Key);
            OldPassword.Clear(); NewPassword1.Clear(); NewPassword2.Clear();
            ShowMessage(L("MasterChanged"), error: false);
        }
        catch (CryptographicException) { ShowMessage(L("ErrCurrentWrong"), error: true); }
        catch (Exception ex) { ShowMessage(L("ErrChange") + ex.Message, error: true); }
        finally { IsEnabled = true; Mouse.OverrideCursor = null; }
    }

    void ShowMessage(string text, bool error)
    {
        PasswordMessage.Text = text;
        PasswordMessage.Foreground = (Brush)FindResource(error ? "DangerBrush" : "AccentBrush");
    }

    void OpenExtensionFolder_Click(object sender, RoutedEventArgs e)
    {
        if (Directory.Exists(extensionDir)) Process.Start("explorer.exe", extensionDir);
        else MessageBox.Show(this, L("ExtMissing"), "EasyPass", MessageBoxButton.OK, MessageBoxImage.Information);
    }
}
