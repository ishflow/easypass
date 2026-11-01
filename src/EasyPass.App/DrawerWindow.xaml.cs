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
    const double TabLong = 44, TabThin = 18, PanelWidth = 280, FirstPanelHeight = 300, TodoListMax = 224, PendingListMax = 184, PanelChrome = 90;
    const double DragStart = 4, EdgeStick = 40; // device pixels of drag before it counts; how much closer another edge must be to take over
    const double LightAt = 0.22, ContentInDelayMs = 160, ContentInMs = 300, ContentOutMs = 160, ContentAtRest = 0.97;
    const int GwlExStyle = -20, ToolWindow = 0x80, NoActivate = 0x08000000;
    const uint MonitorNearest = 2, SwpNoZOrder = 0x4, SwpNoActivate = 0x10;

    [StructLayout(LayoutKind.Sequential)] struct NativePoint { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct NativeRect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int Size; public NativeRect Monitor, Work; public uint Flags; }

    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out NativePoint point);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(NativePoint point, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int width, int height, uint flags);

    readonly MainWindow main;
    bool expanded, dragging, reopen;
    double tabThick = TabThin; // 18 up to two digits; on a side edge the handle widens for more, never clips the count
    double panelHeight = FirstPanelHeight;
    readonly DrawerMotion motion = new();
    readonly SolidColorBrush blobFill = new(), blobLine = new(), glyphInk = new();
    readonly Color handleFill, panelFill, panelLine, handleInk, panelInk;
    DockBox box;
    TimeSpan lastFrame;
    bool rendering;
    DockEdge edge = DockEdge.Right;
    NativePoint spot, pressedAt; // device pixels; spot is where the handle was left, and picks the screen
    bool spotKnown;

    public DrawerWindow(MainWindow main)
    {
        InitializeComponent();
        this.main = main;
        Color Brush(string key) => ((SolidColorBrush)FindResource(key)).Color;
        (handleFill, panelFill, panelLine, handleInk, panelInk) = (Brush("TextBrush"), Brush("SurfaceBrush"), Brush("Line2Brush"), Colors.White, Brush("TextSecondaryBrush"));
        Blob.Fill = blobFill;
        Blob.Stroke = blobLine;
        Glyph.Stroke = glyphInk;
        SystemEvents.DisplaySettingsChanged += DisplayChanged; // another thread
        SystemEvents.UserPreferenceChanged += PreferenceChanged; // the taskbar moving changes the work area
    }

    protected override void OnClosed(EventArgs e)
    {
        SystemEvents.DisplaySettingsChanged -= DisplayChanged;
        SystemEvents.UserPreferenceChanged -= PreferenceChanged;
        base.OnClosed(e);
    }

    void DisplayChanged(object? sender, EventArgs e) => Dispatcher.BeginInvoke(() => { if (IsVisible && !dragging) Place(); });

    void PreferenceChanged(object? sender, UserPreferenceChangedEventArgs e)
    {
        if (e.Category == UserPreferenceCategory.Desktop) DisplayChanged(sender, e);
    }

    /// <summary>No vault open: no tab.</summary>
    internal bool Available
    {
        set
        {
            if (!value)
            {
                expanded = false;
                if (Tab.IsMouseCaptured) Tab.ReleaseMouseCapture();
            }
            if (value == IsVisible) return;
            if (value)
            {
                RestoreSpot();
                RefreshBadge();
                Show();
                Place(); // after Show: Show would put the window back on its own Left and Top
            }
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
        if (!expanded && !dragging) RefreshBadge();
    }

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
        var thick = count > 0 && DrawerDock.IsVertical(edge) ? Math.Max(TabThin, Math.Ceiling(CountBadge.DesiredSize.Width) + 2) : TabThin;
        if (thick == tabThick) return;
        tabThick = thick;
        if (IsVisible && !dragging) Place();
    }

    // A window that is never activated keeps the focus where the user has it; only the tab opens and closes it
    void Window_SourceInitialized(object? sender, EventArgs e)
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        SetWindowLong(hwnd, GwlExStyle, GetWindowLong(hwnd, GwlExStyle) | NoActivate | ToolWindow);
    }

    void RestoreSpot()
    {
        if (DrawerDock.Parse(AppPaths.DrawerSpot) is not { } saved) return;
        (edge, spot, spotKnown) = (saved.Edge, new NativePoint { X = (int)saved.X, Y = (int)saved.Y }, true);
    }

    // The screen around the point, or the nearest one when the point's screen is gone
    static DockArea WorkArea(NativePoint point, double scale)
    {
        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>() };
        if (!GetMonitorInfo(MonitorFromPoint(point, MonitorNearest), ref info))
        {
            var area = SystemParameters.WorkArea; // already in device-independent units
            return new DockArea(area.Left, area.Top, area.Right, area.Bottom);
        }
        return new DockArea(info.Work.Left / scale, info.Work.Top / scale, info.Work.Right / scale, info.Work.Bottom / scale);
    }

    double Scale => VisualTreeHelper.GetDpi(this).DpiScaleX;

    // The whole layout for the current edge, spot and panel height. A slide only redraws inside this box.
    void Place()
    {
        var scale = Scale;
        if (!spotKnown)
        {
            // first run: the middle of the main screen's right edge
            var screen = SystemParameters.WorkArea;
            spot = new NativePoint { X = (int)((screen.Right - 1) * scale), Y = (int)((screen.Top + screen.Height / 2) * scale) };
            spotKnown = true;
        }
        var area = WorkArea(spot, scale);
        box = DrawerDock.Box(edge, area, spot.X / scale, spot.Y / scale, PanelWidth, panelHeight, tabThick, TabLong);
        var vertical = DrawerDock.IsVertical(edge);

        var listMax = Math.Max(60, (area.Bottom - area.Top - PanelChrome) / 2);
        TodoItems.MaxHeight = Math.Min(TodoListMax, listMax);
        PendingItems.MaxHeight = Math.Min(PendingListMax, listMax);

        Panel.Width = vertical ? box.PanelDepth : box.PanelAlong;
        Panel.MaxHeight = vertical ? box.PanelAlong : box.PanelDepth;
        Tab.Width = vertical ? tabThick : TabLong;
        Tab.Height = vertical ? TabLong : tabThick;
        TabContent.Orientation = vertical ? Orientation.Vertical : Orientation.Horizontal;
        CountBadge.Margin = vertical ? new Thickness(0, 0, 0, 6) : new Thickness(0, 0, 6, 0);
        var panelAt = At(DrawerDock.Pad, 0);
        // At gives the point on the wall side: the panel's far corner comes from its size on the right and bottom walls
        Canvas.SetLeft(Panel, edge == DockEdge.Right ? panelAt.X - Panel.Width : panelAt.X);
        Canvas.SetTop(Panel, edge == DockEdge.Bottom ? panelAt.Y - Panel.MaxHeight : panelAt.Y);
        PanelScale.CenterX = Panel.Width / 2;
        PanelScale.CenterY = Panel.MaxHeight / 2;

        Settle();
        int left = (int)Math.Round(box.Left * scale), top = (int)Math.Round(box.Top * scale);
        // one call, so position and size change together
        SetWindowPos(new WindowInteropHelper(this).Handle, IntPtr.Zero, left, top,
            (int)Math.Round((box.Left + box.Width) * scale) - left, (int)Math.Round((box.Top + box.Height) * scale) - top, SwpNoZOrder | SwpNoActivate);
    }

    // From "along the wall, away from the wall" to the window's own x and y
    Point At(double along, double depth) => edge switch
    {
        DockEdge.Right => new Point(box.Width - depth, along),
        DockEdge.Left => new Point(depth, along),
        DockEdge.Top => new Point(along, depth),
        _ => new Point(along, box.Height - depth),
    };

    double GlyphAngle()
    {
        var closed = edge switch { DockEdge.Right => 0, DockEdge.Left => 180, DockEdge.Top => -90, _ => 90 };
        return closed + 180 * Math.Clamp(motion.Value, 0, 1);
    }

    static Color Mix(Color from, Color to, double t)
    {
        byte Channel(byte a, byte b) => (byte)Math.Round(a + (b - a) * t);
        return Color.FromArgb(Channel(from.A, to.A), Channel(from.R, to.R), Channel(from.G, to.G), Channel(from.B, to.B));
    }

    // One frame: the shape, the clip the content sits in, and the handle riding on the free side
    void Draw()
    {
        var (start, curves) = DrawerShape.Outline(motion.Value, box.TabOffset, TabLong, tabThick, DrawerDock.Pad, box.PanelAlong, box.PanelDepth, DrawerDock.IsVertical(edge) ? box.Height : box.Width);
        var outline = new StreamGeometry();
        using (var pen = outline.Open())
        {
            pen.BeginFigure(At(start, 0), isFilled: true, isClosed: true);
            foreach (var curve in curves) pen.QuadraticBezierTo(At(curve.ControlAlong, curve.ControlDepth), At(curve.Along, curve.Depth), isStroked: true, isSmoothJoin: true);
        }
        outline.Freeze();
        Blob.Data = outline;
        Content.Clip = outline;

        // dark handle to light panel in the first moments, so no grey blob and no content on dark
        var light = Math.Clamp(motion.Value / LightAt, 0, 1);
        blobFill.Color = Mix(handleFill, panelFill, light);
        blobLine.Color = Mix(handleFill, panelLine, light);
        glyphInk.Color = Mix(handleInk, panelInk, light);
        GlyphTurn.Angle = GlyphAngle();

        var reach = curves.Max(c => c.Depth);
        var center = At(box.TabOffset + TabLong / 2, reach - tabThick / 2);
        Canvas.SetLeft(Tab, center.X - Tab.Width / 2);
        Canvas.SetTop(Tab, center.Y - Tab.Height / 2);
    }

    // Stops any slide and shows the current state at once
    void Settle()
    {
        motion.Jump(expanded ? 1 : 0);
        StopRendering();
        Fade(expanded ? 1 : 0, 0, 0);
        Panel.Visibility = expanded ? Visibility.Visible : Visibility.Hidden;
        Draw();
    }

    void Fade(double to, double delayMs, double ms)
    {
        var scaled = to == 1 ? 1 : ContentAtRest;
        if (ms == 0)
        {
            Panel.BeginAnimation(OpacityProperty, null);
            PanelScale.BeginAnimation(ScaleTransform.ScaleXProperty, null);
            PanelScale.BeginAnimation(ScaleTransform.ScaleYProperty, null);
            Panel.Opacity = to;
            PanelScale.ScaleX = PanelScale.ScaleY = scaled;
            return;
        }
        AnimationTimeline Run(double value) => new DoubleAnimation(value, TimeSpan.FromMilliseconds(ms)) { BeginTime = TimeSpan.FromMilliseconds(delayMs) };
        Panel.BeginAnimation(OpacityProperty, Run(to));
        PanelScale.BeginAnimation(ScaleTransform.ScaleXProperty, Run(scaled));
        PanelScale.BeginAnimation(ScaleTransform.ScaleYProperty, Run(scaled));
    }

    void Toggle(bool open)
    {
        if (open == expanded) return;
        if (open) Fill(); // before the state changes: if the height changed, Fill places the window with the shape still closed
        expanded = open;
        if (!SystemParameters.ClientAreaAnimation) { Settle(); return; } // the user turned Windows animations off

        if (open)
        {
            Panel.Visibility = Visibility.Visible;
            Fade(1, ContentInDelayMs, ContentInMs);
            motion.Open();
        }
        else
        {
            Fade(0, 0, ContentOutMs);
            motion.Close();
        }
        lastFrame = TimeSpan.Zero;
        if (!rendering) { rendering = true; CompositionTarget.Rendering += Frame; }
    }

    void Frame(object? sender, EventArgs e)
    {
        var now = ((RenderingEventArgs)e).RenderingTime;
        if (now == lastFrame) return; // WPF can call twice for one frame
        if (lastFrame != TimeSpan.Zero) motion.Step((now - lastFrame).TotalSeconds);
        lastFrame = now;
        Draw();
        if (motion.Moving) return;
        StopRendering();
        if (!expanded) Panel.Visibility = Visibility.Hidden;
    }

    void StopRendering()
    {
        if (rendering) CompositionTarget.Rendering -= Frame;
        rendering = false;
    }

    // A press that does not travel is a click; one that does slides the handle along the walls.
    void Tab_Down(object sender, MouseButtonEventArgs e)
    {
        GetCursorPos(out pressedAt);
        Tab.CaptureMouse();
        e.Handled = true;
    }

    void Tab_Move(object sender, MouseEventArgs e)
    {
        if (!Tab.IsMouseCaptured) return;
        GetCursorPos(out var now);
        if (!dragging)
        {
            if (Math.Abs(now.X - pressedAt.X) < DragStart && Math.Abs(now.Y - pressedAt.Y) < DragStart) return;
            dragging = true;
            reopen = expanded;
            expanded = false; // only the handle travels
        }
        var scale = Scale;
        edge = DrawerDock.Nearest(WorkArea(now, scale), now.X / scale, now.Y / scale, edge, EdgeStick / scale);
        spot = now;
        if (!DrawerDock.IsVertical(edge)) tabThick = TabThin;
        Place();
    }

    void Tab_Up(object sender, MouseButtonEventArgs e)
    {
        if (!Tab.IsMouseCaptured) return;
        if (!dragging) Toggle(!expanded);
        Tab.ReleaseMouseCapture(); // ends a drag in Tab_LostCapture
        e.Handled = true;
    }

    void Tab_LostCapture(object sender, MouseEventArgs e)
    {
        if (!dragging) return;
        dragging = false;
        AppPaths.DrawerSpot = DrawerDock.Save(edge, spot.X, spot.Y);
        RefreshBadge(); // the handle's width depends on the edge
        if (reopen && IsVisible) Toggle(true);
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
        FitPanel();
    }

    // The panel is as tall as its rows, up to the lists' limits; a short list makes a small panel
    void FitPanel()
    {
        var limit = Panel.MaxHeight;
        Panel.MaxHeight = double.PositiveInfinity;
        UpdateLayout(); // a real pass: a list that was never laid out reports no rows to a bare Measure
        var height = Math.Ceiling(Panel.DesiredSize.Height);
        if (height == panelHeight) { Panel.MaxHeight = limit; return; } // a reopening mid-close must not jump
        panelHeight = height;
        Place();
    }

    void Row_Click(object sender, MouseButtonEventArgs e)
    {
        if (((ListBoxItem)sender).DataContext is not DrawerLine item) return;
        main.ShowFromTray();
        main.OpenEntry(item.EntryId);
    }
}
