using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using EasyPass.Core;
using static EasyPass.App.Loc;

namespace EasyPass.App;

/// <summary>The open client's work for this month (spec §7c). Its own save; the rules live in <see cref="Work.Save"/>.</summary>
public partial class EntryWorkView : UserControl
{
    const int MaxHours = 8760, MaxDays = 364; // the host refuses a reminder over a year away

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

    readonly DispatcherTimer savedTimer = new() { Interval = TimeSpan.FromSeconds(1) };

    public EntryWorkView()
    {
        InitializeComponent();
        savedTimer.Tick += (_, _) => { savedTimer.Stop(); SavedMark.Visibility = Visibility.Hidden; };
    }

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
        var due = picks.Where(p => statuses.GetValueOrDefault(p.Key) == Work.Partial).ToDictionary(p => p.Key, p => p.Value.Days
            ? new DateTime(now.Year, now.Month, now.Day, 9, 0, 0, DateTimeKind.Local).AddDays(p.Value.N).ToUniversalTime()
            : now.ToUniversalTime().AddHours(p.Value.N));
        if (!Main.Write(d => Work.Save(d, id, m, statuses, due, now.ToUniversalTime()))) return false;
        Discard();
        Refresh(Main.ActiveVault, id);
        Flash();
        return true;
    }

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
        Heading.Text = picking ? L("WorkPickTitle") : string.Format(L("WorkMonthTitle"), MonthName(month));
        Heading.Visibility = pool.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        EmptyText.Visibility = pool.Count > 0 ? Visibility.Collapsed : Visibility.Visible;
        Actions.Visibility = pool.Count > 0 && !picking ? Visibility.Visible : Visibility.Collapsed;
        EditLink.Visibility = IsDirty ? Visibility.Collapsed : Visibility.Visible;
        Rows.Children.Clear();
        if (pool.Count == 0) return;
        if (picking) { BuildPick(); return; }
        foreach (var task in tasks) Rows.Children.Add(Row(task, focusTask));
        if (pool.Any(t => !tasks.Contains(t)))
        {
            var add = new Button { Height = 26, Padding = new Thickness(10, 0, 10, 0), FontSize = 12, HorizontalAlignment = HorizontalAlignment.Left };
            add.SetResourceReference(ContentProperty, "TaskAdd");
            add.Click += (_, _) => AddTasks();
            Rows.Children.Add(add);
        }
        SaveButton.IsEnabled = IsDirty && Valid;
    }

    // Unsaved buttons stay: the refresh inside Write keeps them (same client, dirty)
    void AddTasks()
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
        var next = new Button { Style = (Style)FindResource("AccentButton"), Height = 28, Padding = new Thickness(14, 0, 14, 0), IsEnabled = ticks!.Count > 0 };
        next.SetResourceReference(ContentProperty, linkOpen ? "Save" : "WorkNext");
        next.Click += (_, _) => Assign();
        foreach (var task in pool)
        {
            var box = new CheckBox { Content = task.Name, IsChecked = ticks.Contains(task.Id), Margin = new Thickness(0, 0, 0, 4) };
            box.Click += (_, _) =>
            {
                if (box.IsChecked == true) ticks.Add(task.Id);
                else ticks.Remove(task.Id);
                next.IsEnabled = ticks.Count > 0;
            };
            Rows.Children.Add(box);
        }
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 6, 0, 0) };
        buttons.Children.Add(next);
        if (linkOpen)
        {
            var close = new Button { Height = 28, Padding = new Thickness(14, 0, 14, 0), Margin = new Thickness(8, 0, 0, 0) };
            close.SetResourceReference(ContentProperty, "Close");
            close.Click += (_, _) => { linkOpen = false; Refresh(Main.ActiveVault, entryId); };
            buttons.Children.Add(close);
        }
        Rows.Children.Add(buttons);
    }

    StackPanel Row(WorkTask task, string? focusTask)
    {
        var row = new StackPanel { Margin = new Thickness(0, 0, 0, 6) };
        var line = new DockPanel();
        var partial = StateButton(task.Id, Work.Partial, "WorkBtnPartial", "WarningBrush");
        var done = StateButton(task.Id, Work.Done, "WorkBtnDone", "SuccessBrush");
        DockPanel.SetDock(partial, Dock.Right);
        DockPanel.SetDock(done, Dock.Right);
        line.Children.Add(partial);
        line.Children.Add(done);
        line.Children.Add(new TextBlock { Text = task.Name, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis });
        row.Children.Add(line);
        if (draft.GetValueOrDefault(task.Id) == Work.Partial) row.Children.Add(ReminderChoice(task.Id, focusTask));
        return row;
    }

    // Pressing the lit button again makes it grey
    Button StateButton(string task, string status, string text, string brush)
    {
        var on = draft.GetValueOrDefault(task) == status;
        var button = Small(on, brush, text);
        button.Click += (_, _) =>
        {
            if (on) draft.Remove(task);
            else draft[task] = status;
            if (draft.GetValueOrDefault(task) != Work.Partial) { picks.Remove(task); customText.Remove(task); }
            Build();
        };
        return button;
    }

    Button Small(bool on, string brush, string? textKey)
    {
        var button = new Button { Height = 26, Padding = new Thickness(10, 0, 10, 0), FontSize = 12, Margin = new Thickness(6, 0, 0, 0) };
        if (textKey != null) button.SetResourceReference(ContentProperty, textKey);
        if (on)
        {
            var fill = (Brush)FindResource(brush);
            (button.Background, button.BorderBrush, button.Tag, button.Foreground) = (fill, fill, fill, Brushes.White); // Tag = the hover fill
        }
        return button;
    }

    WrapPanel ReminderChoice(string task, string? focusTask)
    {
        var panel = new WrapPanel { Margin = new Thickness(0, 4, 0, 0) };
        var chosen = picks.TryGetValue(task, out var current);
        var info = !chosen && open.TryGetValue(task, out var set)
            ? set.Dismissed ? L("WorkReminderClosed") : $"{L("WorkRemind")} {set.Due.ToLocalTime().ToString("g", Culture)}"
            : L("WorkRemind");
        panel.Children.Add(new TextBlock { Text = info, FontSize = 12, VerticalAlignment = VerticalAlignment.Center,
            Foreground = (Brush)FindResource("TextSecondaryBrush") });
        foreach (var (key, pick) in new[] { ("WorkH2", new Pick(false, 2, false)), ("WorkH5", new Pick(false, 5, false)),
                     ("WorkTomorrow", new Pick(true, 1, false)), ("WorkD2", new Pick(true, 2, false)) })
        {
            var button = Small(chosen && current == pick, "AccentBrush", key);
            button.Click += (_, _) => { picks[task] = pick; customText.Remove(task); Build(); };
            panel.Children.Add(button);
        }

        var box = new TextBox { Width = 56, Height = 26, FontSize = 12, Padding = new Thickness(6, 0, 6, 0), MaxLength = 4, Margin = new Thickness(6, 0, 0, 0),
            Text = customText.GetValueOrDefault(task, "") };
        if (chosen && current.Custom) box.BorderBrush = (Brush)FindResource("AccentBrush");
        var unit = Small(false, "AccentBrush", customDays.Contains(task) ? "WorkDays" : "WorkHours");
        box.TextChanged += (_, _) => { customText[task] = box.Text; SetCustom(task, box.Text); };
        unit.Click += (_, _) => { if (!customDays.Remove(task)) customDays.Add(task); SetCustom(task, box.Text); };
        if (focusTask == task) box.Loaded += (_, _) => { box.Focus(); box.CaretIndex = box.Text.Length; };
        // one child, so the number and its unit never part across lines
        var custom = new StackPanel { Orientation = Orientation.Horizontal };
        custom.Children.Add(box);
        custom.Children.Add(unit);
        panel.Children.Add(custom);
        return panel;
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
