using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
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
    List<WorkTask> tasks = [];
    Dictionary<string, string> baseline = [];                 // what the vault holds
    Dictionary<string, string> draft = [];                    // what the buttons show
    Dictionary<string, (DateTime Due, bool Dismissed)> open = []; // reminders already set: kept unless a new time is picked
    readonly Dictionary<string, Pick> picks = [];             // a newly chosen time, the only kind passed to Work.Save
    readonly Dictionary<string, string> customText = [];
    readonly HashSet<string> customDays = [];

    public EntryWorkView() => InitializeComponent();

    internal bool IsDirty => draft.Count != baseline.Count || draft.Any(d => baseline.GetValueOrDefault(d.Key) != d.Value) || picks.Count > 0;

    bool Valid => draft.Where(d => d.Value == Work.Partial).All(d => picks.ContainsKey(d.Key) || open.ContainsKey(d.Key));

    /// <summary>Shows the client's month. Unsaved buttons of the same client survive a reload.</summary>
    internal void Refresh(Vault? vault, string? id)
    {
        if (vault == null || id == null || !vault.Data.Entries.Any(e => e.Id == id))
        {
            (entryId, draft, baseline) = (null, [], []);
            picks.Clear();
            Visibility = Visibility.Collapsed;
            return;
        }
        var keep = id == entryId && IsDirty;
        entryId = id;
        var data = vault.Data;
        tasks = [.. data.Tasks.Where(t => !t.Archived)];
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
        Visibility = Visibility.Visible;
        Build();
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
        return true;
    }

    void Save_Click(object sender, RoutedEventArgs e) => Save();

    void Build(string? focusTask = null)
    {
        Heading.Text = string.Format(L("WorkMonthTitle"), MonthName(month));
        Heading.Visibility = SaveButton.Visibility = tasks.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        EmptyText.Visibility = tasks.Count > 0 ? Visibility.Collapsed : Visibility.Visible;
        Rows.Children.Clear();
        foreach (var task in tasks) Rows.Children.Add(Row(task, focusTask));
        SaveButton.IsEnabled = IsDirty && Valid;
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
        panel.Children.Add(box);
        panel.Children.Add(unit);
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
