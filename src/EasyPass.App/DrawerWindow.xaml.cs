using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using EasyPass.Core;
using Microsoft.Win32;
using static EasyPass.App.Loc;

namespace EasyPass.App;

/// <summary>One row of either list; public because WPF bindings do not see internal types.</summary>
public sealed record DrawerLine(string EntryId, string Name, ImageSource Glyph, string GlyphName, string Task = "", string Time = "", string TimeFull = "", bool Muted = false, bool Late = false);

/// <summary>Edge drawer (spec §13): this month's unfinished clients and the open reminders. Reads memory only, and only while open. Never shows a password.</summary>
public partial class DrawerWindow : Window
{
    const double TabHeight = 52, PanelWidth = 330, EdgeGap = 16, PanelMaxHeight = 760;
    const int GwlExStyle = -20, ToolWindow = 0x80, NoActivate = 0x08000000;

    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);

    readonly MainWindow main;
    bool expanded, moving;
    double tabWidth = 18; // 18 up to two digits; the handle widens for more, never clips the count

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
            if (!value) { expanded = false; Glyph.Data = Chevron(false); }
            if (value == IsVisible) return;
            if (value) { RefreshBadge(); Place(Target()); Show(); }
            else Hide();
        }
    }

    /// <summary>The app's reload brought new data.</summary>
    internal void Reload()
    {
        if (expanded) Fill();
        else RefreshBadge();
    }

    // The count on the handle needs the list once; hovering the handle catches changes made inside the app
    void Tab_MouseEnter(object sender, MouseEventArgs e)
    {
        if (!expanded && !moving) RefreshBadge();
    }

    Geometry Chevron(bool open) => (Geometry)FindResource(open ? "ChevronRight" : "ChevronLeft");

    void RefreshBadge()
    {
        if (main.ActiveVault is not { } vault) return;
        SetBadge(Work.Todo(vault.Data, Work.MonthOf(DateTime.Now)).Unfinished);
    }

    void SetBadge(int count)
    {
        CountBadge.Visibility = count > 0 ? Visibility.Visible : Visibility.Collapsed;
        CountText.Text = count.ToString();
        CountBadge.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        var width = count > 0 ? Math.Max(18, Math.Ceiling(CountBadge.DesiredSize.Width) + 2) : 18;
        if (width == tabWidth) return;
        tabWidth = Tab.Width = width;
        if (IsVisible && !moving) Place(Target());
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
        if (!expanded) return new Rect(area.Right - tabWidth, area.Top + (area.Height - TabHeight) / 2, tabWidth, TabHeight);
        var width = Math.Min(PanelWidth + tabWidth, area.Width);
        var height = Math.Min(area.Height - 2 * EdgeGap, PanelMaxHeight);
        return new Rect(area.Right - width, area.Top + (area.Height - height) / 2, width, height);
    }

    // The top list is as tall as its rows, up to 60% of the drawer; the bottom one takes the rest. Both scroll on their own (and stay virtualized).
    void Window_SizeChanged(object sender, SizeChangedEventArgs e) => TodoItems.MaxHeight = Math.Max(120, e.NewSize.Height * 0.6);

    void Place(Rect r) => (Left, Top, Width, Height) = (r.Left, r.Top, r.Width, r.Height);

    void Tab_Click(object sender, MouseButtonEventArgs e) => Toggle(!expanded);

    void Toggle(bool open)
    {
        if (moving || open == expanded) return;
        expanded = open;
        Glyph.Data = Chevron(open);
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
        var partial = (ImageSource)FindResource("GlyphPartial");
        var none = (ImageSource)FindResource("GlyphNone");

        // Unfinished first, then not started; done ones are left out
        var list = Work.Todo(data, Work.MonthOf(DateTime.Now));
        var todo = list.Rows.Where(r => r.Group != TodoGroup.Done).OrderBy(r => r.Group == TodoGroup.Unfinished ? 0 : 1)
            .Select(r => r.Group == TodoGroup.Unfinished
                ? new DrawerLine(r.Entry.Id, Name(r.Entry), partial, L("TodoUnfinished"))
                : new DrawerLine(r.Entry.Id, Name(r.Entry), none, L("TodoNotStarted"), Muted: true)).ToList();
        MonthText.Text = MonthName(Work.MonthOf(DateTime.Now)).Split(' ')[0];
        TodoHeading.Text = string.Format(L("DrawerTodoFmt"), todo.Count);
        UnfinishedCount.Text = list.Unfinished.ToString();
        NotStartedCount.Text = list.NotStarted.ToString();
        TodoItems.ItemsSource = todo;
        SetBadge(list.Unfinished);

        var tasks = data.Tasks.ToDictionary(t => t.Id, t => t.Name);
        var entries = data.Entries.ToDictionary(e => e.Id);
        // overdue first, then the coming ones
        var pending = Work.Due(data, now).Select(r => (r, late: true)).Concat(Work.Planned(data, now).Select(r => (r, late: false)))
            .Select(p =>
            {
                var at = p.r.DueAt.ToLocalTime();
                return new DrawerLine(p.r.EntryId, Name(entries[p.r.EntryId]), partial, L("TodoUnfinished"), tasks[p.r.TaskId], at.ToString("dd.MM HH:mm"), at.ToString("g", Culture), Late: p.late);
            }).ToList();
        PendingCount.Text = pending.Count.ToString();
        PendingItems.ItemsSource = pending;
    }

    void Row_Click(object sender, MouseButtonEventArgs e)
    {
        if (((ListBoxItem)sender).DataContext is not DrawerLine item) return;
        main.ShowFromTray();
        main.OpenEntry(item.EntryId);
    }
}
