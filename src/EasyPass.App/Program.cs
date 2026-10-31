using System.Globalization;
using System.Runtime.InteropServices;
using System.Windows;
using EasyPass.Core;

namespace EasyPass.App;

static class Program
{
    [DllImport("user32.dll")]
    static extern bool AllowSetForegroundWindow(int processId);
    const int AnyProcess = -1;

    [STAThread]
    static void Main(string[] args)
    {
        var show = new EventWaitHandle(false, EventResetMode.AutoReset, "EasyPass.App.Show");
        var quit = new EventWaitHandle(false, EventResetMode.AutoReset, "EasyPass.App.Quit");
        if (args.Contains("--quit")) { quit.Set(); return; } // the installer's way to close an app that has no window
        using var instance = new Mutex(true, "EasyPass.App", out var first);
        if (!first)
        {
            AllowSetForegroundWindow(AnyProcess); // this process was started by the user, the running one was not
            if (!args.Contains("--background")) show.Set(); // sign-in start must not pop up a window that is already running
            return;
        }

        var app = new Application
        {
            Resources = (ResourceDictionary)Application.LoadComponent(new Uri("/EasyPass;component/Theme.xaml", UriKind.Relative)),
            ShutdownMode = ShutdownMode.OnExplicitShutdown, // the window hides to the tray, reminder windows stand alone
        };
        Loc.Apply(AppPaths.Lang);
        // son güvenlik ağı: beklenmeyen hata (ör. %APPDATA% yazılamadı) uygulamayı kapatıp formdaki veriyi kaybettirmesin
        app.DispatcherUnhandledException += (_, e) =>
        {
            MessageBox.Show(e.Exception.Message, Loc.L("ErrTitle"), MessageBoxButton.OK, MessageBoxImage.Error);
            e.Handled = true;
        };
        var window = new MainWindow();
        app.SessionEnding += (_, e) => { if (window.ReadyToLeave()) app.Shutdown(); else e.Cancel = true; }; // no quitting flag left behind if Windows cancels the shutdown
        new Thread(() =>
        {
            while (true)
            {
                var signal = WaitHandle.WaitAny([show, quit]);
                window.Dispatcher.InvokeAsync(signal == 0 ? window.ShowFromTray : window.Quit);
            }
        }) { IsBackground = true }.Start();
        if (!args.Contains("--background")) window.Show();
        app.Run();
    }
}

/// <summary>Arayüz dili: Strings.en.xaml / Strings.ru.xaml / Strings.tr.xaml; XAML {DynamicResource} ile anında değişir.</summary>
static class Loc
{
    static ResourceDictionary? current;

    public static void Apply(string lang)
    {
        var known = AppPaths.Languages.Contains(lang) ? lang : AppPaths.DefaultLang;
        var strings = (ResourceDictionary)Application.LoadComponent(
            new Uri($"/EasyPass;component/Strings.{known}.xaml", UriKind.Relative));
        var merged = Application.Current.Resources.MergedDictionaries;
        if (current != null) merged.Remove(current);
        merged.Add(current = strings);
    }

    public static string L(string key) => (string)Application.Current.Resources[key];

    public static CultureInfo Culture => CultureInfo.GetCultureInfo(AppPaths.Lang);

    /// <summary>"yyyy-MM" as "Ноябрь 2026".</summary>
    public static string MonthName(string month)
    {
        if (!DateTime.TryParseExact(month, "yyyy-MM", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) return month;
        var culture = Culture;
        var name = date.ToString("MMMM yyyy", culture);
        return char.ToUpper(name[0], culture) + name[1..];
    }
}
