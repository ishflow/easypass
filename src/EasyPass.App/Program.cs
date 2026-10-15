using System.Windows;
using EasyPass.Core;

namespace EasyPass.App;

static class Program
{
    [STAThread]
    static void Main()
    {
        var app = new Application
        {
            Resources = (ResourceDictionary)Application.LoadComponent(new Uri("/EasyPass;component/Theme.xaml", UriKind.Relative)),
        };
        Loc.Apply(AppPaths.Lang);
        // son güvenlik ağı: beklenmeyen hata (ör. %APPDATA% yazılamadı) uygulamayı kapatıp formdaki veriyi kaybettirmesin
        app.DispatcherUnhandledException += (_, e) =>
        {
            MessageBox.Show(e.Exception.Message, Loc.L("ErrTitle"), MessageBoxButton.OK, MessageBoxImage.Error);
            e.Handled = true;
        };
        app.Run(new MainWindow());
    }
}

/// <summary>Arayüz dili: Strings.ru.xaml / Strings.tr.xaml; XAML {DynamicResource} ile anında değişir.</summary>
static class Loc
{
    static ResourceDictionary? current;

    public static void Apply(string lang)
    {
        var strings = (ResourceDictionary)Application.LoadComponent(
            new Uri($"/EasyPass;component/Strings.{(lang == "tr" ? "tr" : "ru")}.xaml", UriKind.Relative));
        var merged = Application.Current.Resources.MergedDictionaries;
        if (current != null) merged.Remove(current);
        merged.Add(current = strings);
    }

    public static string L(string key) => (string)Application.Current.Resources[key];
}
