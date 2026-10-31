using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media.Animation;
using EasyPass.Core;
using Microsoft.Win32;
using static EasyPass.App.Loc;

namespace EasyPass.App;

/// <summary>Edge drawer (spec §13): this month's unfinished clients and the open reminders. Reads memory only, and only while open. Never shows a password.</summary>
public partial class DrawerWindow : Window
{
    const double TabWidth = 24, TabHeight = 112, PanelWidth = 320;
    const int GwlExStyle = -20, ToolWindow = 0x80, NoActivate = 0x08000000;

    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);

    readonly MainWindow main;
    bool expanded, moving;

    public DrawerWindow(MainWindow main)
    {
        InitializeComponent();
        this.main = main;
        SystemEvents.DisplaySettingsChanged += DisplayChanged; // another thread
    }

    protected override void OnClosed(EventArgs e)
    {
        SystemEvents.DisplaySettingsChanged -= DisplayChanged;
        base.OnClosed(e);
    }

    void DisplayChanged(object? sender, EventArgs e) => Dispatcher.BeginInvoke(() => { if (!moving) Place(Target()); });

    /// <summary>No vault open: no tab.</summary>
    internal bool Available
    {
        set
        {
            if (!value) { expanded = false; Glyph.Text = "‹"; }
            if (value == IsVisible) return;
            if (value) { Place(Target()); Show(); }
            else Hide();
        }
    }

    /// <summary>The app's reload brought new data.</summary>
    internal void Reload()
    {
        if (expanded) Fill();
    }

    // A window that is never activated keeps the focus where the user has it; only the tab opens and closes it
    void Window_SourceInitialized(object? sender, EventArgs e) => SetActivatable(false, tool: true);

    void SetActivatable(bool on, bool tool = false)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        if (hwnd == IntPtr.Zero) return;
        var style = GetWindowLong(hwnd, GwlExStyle);
        style = on ? style & ~NoActivate : style | NoActivate;
        SetWindowLong(hwnd, GwlExStyle, tool ? style | ToolWindow : style);
    }

    Rect Target()
    {
        var area = SystemParameters.WorkArea;
        if (!expanded) return new Rect(area.Right - TabWidth, area.Top + (area.Height - TabHeight) / 2, TabWidth, TabHeight);
        var width = Math.Min(PanelWidth + TabWidth, area.Width);
        return new Rect(area.Right - width, area.Top, width, area.Height);
    }

    // The top list is as tall as its rows, up to 60% of the drawer; the bottom one takes the rest. Both scroll on their own (and stay virtualized).
    void Window_SizeChanged(object sender, SizeChangedEventArgs e) => TodoItems.MaxHeight = Math.Max(120, e.NewSize.Height * 0.6);

    void Place(Rect r) => (Left, Top, Width, Height) = (r.Left, r.Top, r.Width, r.Height);

    void Tab_Click(object sender, MouseButtonEventArgs e) => Toggle(!expanded);

    void Toggle(bool open)
    {
        if (moving || open == expanded) return;
        expanded = open;
        Glyph.Text = open ? "›" : "‹";
        if (open) Fill();
        Slide(Target(), then: () => { });
    }

    void Slide(Rect to, Action then)
    {
        moving = true;
        var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
        foreach (var (property, value) in new[] { (LeftProperty, to.Left), (TopProperty, to.Top), (WidthProperty, to.Width), (HeightProperty, to.Height) })
        {
            var animation = new DoubleAnimation(value, TimeSpan.FromMilliseconds(200)) { EasingFunction = ease, FillBehavior = FillBehavior.HoldEnd };
            animation.Completed += (_, _) =>
            {
                SetValue(property, value);
                BeginAnimation(property, null);
                if (property == HeightProperty) { moving = false; then(); }
            };
            BeginAnimation(property, animation);
        }
    }

    void Fill()
    {
        if (main.ActiveVault is not { } vault) return;
        var data = vault.Data;
        var now = DateTime.UtcNow;
        string Name(Entry e) => e.FullName == "" ? e.Username : e.FullName;

        // Unfinished first, then not started; done ones are left out
        var todo = Work.Todo(data, Work.MonthOf(DateTime.Now)).Rows.Where(r => r.Group != TodoGroup.Done).OrderBy(r => r.Group == TodoGroup.Unfinished ? 0 : 1)
            .Select(r => new DrawerItem(r.Entry.Id, Name(r.Entry), L(r.Group == TodoGroup.Unfinished ? "TodoUnfinished" : "TodoNotStarted"))).ToList();
        TodoHeading.Text = string.Format(L("DrawerTodoFmt"), todo.Count);
        TodoItems.ItemsSource = todo;

        var tasks = data.Tasks.ToDictionary(t => t.Id, t => t.Name);
        var entries = data.Entries.ToDictionary(e => e.Id);
        // overdue first, then the coming ones
        PendingItems.ItemsSource = Work.Due(data, now).Concat(Work.Planned(data, now))
            .Select(r => new DrawerItem(r.EntryId, Name(entries[r.EntryId]), $"{tasks[r.TaskId]} · {r.DueAt.ToLocalTime().ToString("g", Culture)}")).ToList();
    }

    void Row_Click(object sender, MouseButtonEventArgs e)
    {
        if (((ListBoxItem)sender).DataContext is not DrawerItem item) return;
        main.ShowFromTray();
        main.OpenEntry(item.EntryId);
    }
}
