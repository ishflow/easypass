using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using EasyPass.Core;
using static EasyPass.App.Loc;

namespace EasyPass.App;

/// <summary>The open client's work for this month (spec §7c). Its own save; the rules live in <see cref="Work.Save"/>.</summary>
public partial class EntryWorkView : UserControl
{
    const int MaxHours = 8760, MaxDays = 364; // the host refuses a reminder over a year away
    const double RemindInset = 26; // the reminder box's padding and border around its row

    // Hours from saving, or the day at 09:00 local (nobody is woken at night)
    readonly record struct Pick(bool Days, int N, bool Custom);

    internal MainWindow Main = null!;
    string? entryId;
    string month = "";
    List<WorkTask> tasks = [];                                // the client's own active tasks
    List<WorkTask> pool = [];                                 // every active task
    bool linkOpen;                                            // "edit the list" was pressed
    HashSet<string>? ticks;                                   // the open selection; null while it is closed
    Dictionary<string, string> baseline = [];                 // what the vault holds
    Dictionary<string, string> draft = [];                    // what the buttons show
    Dictionary<string, (DateTime Due, bool Dismissed)> open = []; // reminders already set: kept unless a new time is picked
    readonly Dictionary<string, Pick> picks = [];             // a newly chosen time, the only kind passed to Work.Save
    readonly Dictionary<string, string> customText = [];
    readonly HashSet<string> customDays = [];
    int builtMode;                                            // the RemindMode the rows were built for

    readonly DispatcherTimer savedTimer = new() { Interval = TimeSpan.FromSeconds(1) };

    public EntryWorkView()
    {
        InitializeComponent();
        savedTimer.Tick += (_, _) => { savedTimer.Stop(); SavedMark.Visibility = Visibility.Hidden; };
        Rows.SizeChanged += (_, e) =>
        {
            if (e.WidthChanged && entryId != null && RemindMode != builtMode && draft.ContainsValue(Work.Partial))
                Build((Keyboard.FocusedElement as TextBox)?.Tag as string);
        };
    }

    // WPF has no container query: the row never wraps, from 540 px it has full labels, below that short ones, below 410 no "Reminder:"
    int RemindMode => (Rows.ActualWidth - RemindInset) switch { >= 540 => 0, >= 410 => 1, _ => 2 };

    void Flash()
    {
        SavedMark.Visibility = Visibility.Visible;
        savedTimer.Stop();
        savedTimer.Start();
    }

    internal bool IsDirty => draft.Count != baseline.Count || draft.Any(d => baseline.GetValueOrDefault(d.Key) != d.Value) || picks.Count > 0;

    bool Picking => tasks.Count == 0 || linkOpen;

    bool Valid => draft.Where(d => d.Value == Work.Partial).All(d => picks.ContainsKey(d.Key) || open.ContainsKey(d.Key));

    /// <summary>Shows the client's month. Unsaved buttons of the same client survive a reload.</summary>
    internal void Refresh(Vault? vault, string? id)
    {
        if (vault == null || id == null || !vault.Data.Entries.Any(e => e.Id == id))
        {
            (entryId, draft, baseline, linkOpen, ticks) = (null, [], [], false, null);
            picks.Clear();
            Visibility = Visibility.Collapsed;
            return;
        }
        var same = id == entryId;
        var keep = same && IsDirty;
        if (!same) (linkOpen, ticks) = (false, null);
        entryId = id;
        var data = vault.Data;
        pool = [.. data.Tasks.Where(t => !t.Archived)];
        tasks = [.. Work.TasksOf(data, data.Entries.First(e => e.Id == id))];
        if (!keep) month = Work.MonthOf(DateTime.Now);
        var active = tasks.Select(t => t.Id).ToHashSet();
        baseline = data.Work.FirstOrDefault(w => w.EntryId == id && w.Month == month)?.Tasks.Where(t => active.Contains(t.Key)).ToDictionary() ?? [];
        open = data.Reminders.Where(r => r.EntryId == id && r.Month == month && r.ResolvedAt is null && active.Contains(r.TaskId))
            .ToDictionary(r => r.TaskId, r => (r.DueAt, r.DismissedAt is not null));
        if (keep)
        {
            foreach (var gone in draft.Keys.Where(k => !active.Contains(k)).ToList()) draft.Remove(gone);
            foreach (var gone in picks.Keys.Where(k => !active.Contains(k)).ToList()) picks.Remove(gone);
        }
        else Discard();
        ticks = Picking ? ticks ?? [.. (tasks.Count > 0 ? tasks.Select(t => t.Id) : pool.Select(t => t.Id).Where(hasStatus))] : null;
        Visibility = Visibility.Visible;
        Build();

        // first time: what already has a status this month comes ticked
        bool hasStatus(string t) => data.Work.Any(w => w.EntryId == id && w.Month == month && w.Tasks.ContainsKey(t));
    }

    /// <summary>Forget the unsaved buttons.</summary>
    internal void Discard()
    {
        draft = new(baseline);
        picks.Clear();
        customText.Clear();
        customDays.Clear();
    }

    /// <summary>True: nothing left unsaved. False: refused (a new orange has no time yet) or not written; the user was told or can see it.</summary>
    internal bool Save()
    {
        if (!IsDirty) return true;
        if (!Valid || entryId is not { } id) return false;
        var (statuses, m, now) = (new Dictionary<string, string>(draft), month, DateTime.Now);
        var due = picks.Where(p => statuses.GetValueOrDefault(p.Key) == Work.Partial).ToDictionary(p => p.Key, p => DueUtc(p.Value, now));
        if (!Main.Write(d => Work.Save(d, id, m, statuses, due, now.ToUniversalTime()))) return false;
        Discard();
        Refresh(Main.ActiveVault, id);
        Flash();
        return true;
    }

    static DateTime DueUtc(Pick pick, DateTime now) => pick.Days
        ? new DateTime(now.Year, now.Month, now.Day, 9, 0, 0, DateTimeKind.Local).AddDays(pick.N).ToUniversalTime()
        : now.ToUniversalTime().AddHours(pick.N);

    void Save_Click(object sender, RoutedEventArgs e) => Save();

    // Not offered while buttons are unsaved: the selection hides them
    void EditList_Click(object sender, RoutedEventArgs e) { linkOpen = true; Refresh(Main.ActiveVault, entryId); }

    void Assign()
    {
        if (entryId is not { } id || ticks is not { Count: > 0 }) return;
        var chosen = pool.Where(t => ticks.Contains(t.Id)).Select(t => t.Id).ToList();
        var (was, wasLink) = (ticks, linkOpen);
        linkOpen = false; // the refresh inside Write shows the new list
        if (Main.Write(d => Work.Assign(d, id, chosen, DateTime.UtcNow))) { Flash(); return; }
        (ticks, linkOpen) = (was, wasLink);
        Refresh(Main.ActiveVault, id);
    }

    void Build(string? focusTask = null)
    {
        var picking = Picking;
        builtMode = RemindMode;
        Heading.Text = picking ? L("WorkPickTitle") : string.Format(L("WorkMonthTitle"), MonthName(month));
        Heading.Visibility = pool.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        Progress.Text = string.Format(L("TodoTitleFmt"), tasks.Count(t => draft.GetValueOrDefault(t.Id) == Work.Done), tasks.Count);
        Progress.Visibility = pool.Count > 0 && !picking ? Visibility.Visible : Visibility.Collapsed;
        EmptyText.Visibility = pool.Count > 0 ? Visibility.Collapsed : Visibility.Visible;
        Actions.Visibility = pool.Count > 0 && !picking ? Visibility.Visible : Visibility.Collapsed;
        EditLink.Visibility = pool.Count > 0 && !picking && !IsDirty ? Visibility.Visible : Visibility.Collapsed;
        AddLink.Visibility = pool.Any(t => !tasks.Contains(t)) ? Visibility.Visible : Visibility.Collapsed;
        Rows.Children.Clear();
        if (pool.Count == 0) return;
        if (picking) { BuildPick(); return; }
        foreach (var task in tasks) Rows.Children.Add(Row(task, focusTask));
        SaveButton.IsEnabled = IsDirty && Valid;
    }

    // Unsaved buttons stay: the refresh inside Write keeps them (same client, dirty)
    void AddTasks_Click(object sender, RoutedEventArgs e)
    {
        if (entryId is not { } id) return;
        var window = new PickTasksWindow(pool.Where(t => !tasks.Contains(t))) { Owner = Window.GetWindow(this) };
        if (window.ShowDialog() != true) return;
        var chosen = window.Chosen;
        // the list as it is in the vault now, plus the ticked ones
        if (Main.Write(d => Work.Assign(d, id, d.Entries.FirstOrDefault(e => e.Id == id) is { } entry
                ? [.. Work.TasksOf(d, entry).Select(t => t.Id).Concat(chosen).Distinct()] : [], DateTime.UtcNow))) Flash();
    }

    void BuildPick()
    {
        var next = new Button { Style = (Style)FindResource("AccentButton"), IsEnabled = ticks!.Count > 0 };
        next.SetResourceReference(ContentProperty, linkOpen ? "Save" : "WorkNext");
        next.Click += (_, _) => Assign();
        foreach (var task in pool)
        {
            var box = new CheckBox { Content = task.Name, IsChecked = ticks.Contains(task.Id) };
            box.Click += (_, _) =>
            {
                if (box.IsChecked == true) ticks.Add(task.Id);
                else ticks.Remove(task.Id);
                next.IsEnabled = ticks.Count > 0;
            };
            Rows.Children.Add(box);
        }
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 6, 0, 0) };
        if (linkOpen)
        {
            var close = new Button { Margin = new Thickness(0, 0, 8, 0) };
            close.SetResourceReference(ContentProperty, "Close");
            close.Click += (_, _) => { linkOpen = false; Refresh(Main.ActiveVault, entryId); };
            buttons.Children.Add(close);
        }
        buttons.Children.Add(next);
        Rows.Children.Add(buttons);
    }

    StackPanel Row(WorkTask task, string? focusTask)
    {
        var partial = draft.GetValueOrDefault(task.Id) == Work.Partial;
        var row = new StackPanel();
        var line = new DockPanel { MinHeight = 34 };
        var states = new StackPanel { Orientation = Orientation.Horizontal };
        states.Children.Add(StateButton(task.Id, Work.Done, "WorkBtnDone", "SegDoneOn"));
        states.Children.Add(StateButton(task.Id, Work.Partial, "WorkBtnPartial", "SegWarnOn"));
        var group = new ContentControl { Style = (Style)FindResource("SegGroup"), Content = states, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(12, 0, 0, 0) };
        DockPanel.SetDock(group, Dock.Right);
        line.Children.Add(group);
        line.Children.Add(new TextBlock { Text = task.Name, FontWeight = FontWeights.Medium, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap,
            Foreground = (Brush)FindResource(partial ? "WarnInkBrush" : "TextBrush") });
        row.Children.Add(line);
        if (partial) row.Children.Add(ReminderChoice(task.Id, focusTask));
        return row;
    }

    // Pressing the lit button again makes it grey
    Button StateButton(string task, string status, string text, string onStyle)
    {
        var on = draft.GetValueOrDefault(task) == status;
        var button = new Button { Style = (Style)FindResource(on ? onStyle : "SegButton") };
        button.SetResourceReference(ContentProperty, text);
        button.Click += (_, _) =>
        {
            if (on) draft.Remove(task);
            else draft[task] = status;
            if (draft.GetValueOrDefault(task) != Work.Partial) { picks.Remove(task); customText.Remove(task); }
            Build();
        };
        return button;
    }

    // A short label is display only: the full text stays as tooltip and accessible name
    void Label(Button button, string full, string shortText)
    {
        button.SetResourceReference(ContentProperty, builtMode == 0 ? full : shortText);
        button.SetResourceReference(ToolTipProperty, full);
        button.SetResourceReference(AutomationProperties.NameProperty, full);
    }

    Border ReminderChoice(string task, string? focusTask)
    {
        var chosen = picks.TryGetValue(task, out var current);
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        if (builtMode < 2)
            row.Children.Add(new TextBlock { Text = L("WorkRemind"), FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0),
                Foreground = (Brush)FindResource("TextSecondaryBrush") });
        foreach (var (key, shortKey, pick) in new[] { ("WorkH2", "WorkH2Short", new Pick(false, 2, false)), ("WorkH5", "WorkH5Short", new Pick(false, 5, false)),
                     ("WorkTomorrow", "WorkTomorrow", new Pick(true, 1, false)), ("WorkD2", "WorkD2Short", new Pick(true, 2, false)) })
        {
            var button = new Button { Style = (Style)FindResource(chosen && current == pick ? "ChipOn" : "Chip"), Margin = new Thickness(0, 0, 6, 0) };
            Label(button, key, shortKey);
            button.Click += (_, _) => { picks[task] = pick; customText.Remove(task); Build(); };
            row.Children.Add(button);
        }

        // Tag: the task, so a rebuild can give the focus back
        var box = new TextBox { Style = (Style)FindResource("ReminderBox"), MaxLength = 4, Tag = task, Text = customText.GetValueOrDefault(task, "") };
        box.SetResourceReference(AutomationProperties.NameProperty, "WorkRemind");
        if (chosen && current.Custom) box.BorderBrush = (Brush)FindResource("AccentBrush");
        box.TextChanged += (_, _) => { customText[task] = box.Text; SetCustom(task, box.Text); };
        if (focusTask == task) box.Loaded += (_, _) => { box.Focus(); box.CaretIndex = box.Text.Length; };
        var units = new StackPanel { Orientation = Orientation.Horizontal };
        foreach (var (days, key, shortKey) in new[] { (false, "WorkHours", "WorkHoursShort"), (true, "WorkDays", "WorkDaysShort") })
        {
            var unit = new Button { Style = (Style)FindResource(customDays.Contains(task) == days ? "ReminderUnitOn" : "ReminderUnit") };
            Label(unit, key, shortKey);
            unit.Click += (_, _) =>
            {
                if (days) customDays.Add(task);
                else customDays.Remove(task);
                SetCustom(task, box.Text);
            };
            units.Children.Add(unit);
        }
        // one child, so the number and its unit stay joined
        var custom = new StackPanel { Orientation = Orientation.Horizontal };
        custom.Children.Add(box);
        custom.Children.Add(new ContentControl { Style = (Style)FindResource("ReminderUnitGroup"), Content = units });
        row.Children.Add(custom);

        var body = new StackPanel();
        body.Children.Add(row);
        if (ReminderLine(task, chosen, current) is { } at) body.Children.Add(at);
        return new Border { Child = body, Background = (Brush)FindResource("SurfaceBrush"), BorderBrush = (Brush)FindResource("WarnLineBrush"), BorderThickness = new Thickness(1),
            CornerRadius = (CornerRadius)FindResource("Radius"), Padding = new Thickness(12, 8, 12, 8), Margin = new Thickness(0, 2, 0, 4) };
    }

    // When it will remind, on its own line: the new choice, else what is already set
    TextBlock? ReminderLine(string task, bool chosen, Pick current)
    {
        var line = new TextBlock { FontSize = 12, Margin = new Thickness(0, 6, 0, 0), TextWrapping = TextWrapping.Wrap, Foreground = (Brush)FindResource("TextSecondaryBrush") };
        DateTime due;
        if (chosen) due = DueUtc(current, DateTime.Now);
        else if (!open.TryGetValue(task, out var set)) return null;
        else if (set.Dismissed) { line.Text = L("WorkReminderClosed"); return line; }
        else due = set.Due;
        var parts = L("WorkRemindAt").Split("{0}");
        line.Inlines.Add(new Run(parts[0]));
        line.Inlines.Add(new Run(due.ToLocalTime().ToString("d MMMM, HH:mm", Culture)) { FontWeight = FontWeights.Medium, Foreground = (Brush)FindResource("TextBrush") });
        line.Inlines.Add(new Run(parts[1]));
        return line;
    }

    // A number that fits the unit becomes the choice; anything else leaves a preset alone
    void SetCustom(string task, string text)
    {
        var days = customDays.Contains(task);
        if (int.TryParse(text, out var n) && n >= 1 && n <= (days ? MaxDays : MaxHours)) picks[task] = new Pick(days, n, true);
        else if (picks.TryGetValue(task, out var p) && p.Custom) picks.Remove(task);
        Build(task);
    }
}
