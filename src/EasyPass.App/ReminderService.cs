using System.Media;
using System.Windows;
using System.Windows.Threading;
using EasyPass.Core;

namespace EasyPass.App;

/// <summary>Reads memory only: the 2 s reload in MainWindow is what brings file changes in. Nothing is written until the user clicks (spec §5).</summary>
sealed class ReminderService
{
    const int MaxWindows = 5, Gap = 8, Edge = 12;

    readonly MainWindow main;
    readonly TrayIcon tray;
    readonly Dictionary<string, ReminderWindow> open = [];
    ReminderWindow? more;

    public ReminderService(MainWindow main, TrayIcon tray)
    {
        this.main = main;
        this.tray = tray;
        new DispatcherTimer(TimeSpan.FromSeconds(30), DispatcherPriority.Background, (_, _) => Check(), main.Dispatcher).Start();
    }

    public void Check()
    {
        if (main.IsQuitting) return;
        var vault = main.ActiveVault;
        tray.Refresh(locked: vault == null);
        var data = vault?.Data;
        var due = data == null ? [] : Work.Due(data, DateTime.UtcNow).ToList();
        main.ShowDueCount(due.Count);

        // dismissed or finished elsewhere (another computer, the panel on the site)
        var dueIds = due.Select(r => r.Id).ToHashSet();
        foreach (var id in open.Keys.Where(id => !dueIds.Contains(id)).ToList())
        {
            open[id].Close();
            open.Remove(id);
        }

        var added = false;
        foreach (var r in due)
        {
            if (!open.TryGetValue(r.Id, out var window))
            {
                if (open.Count >= MaxWindows) continue;
                var id = r.Id;
                open[id] = window = new ReminderWindow(() => Dismiss(id));
                added = true;
            }
            var entry = data!.Entries.FirstOrDefault(e => e.Id == r.EntryId);
            window.SetReminder(data.Tasks.FirstOrDefault(t => t.Id == r.TaskId)?.Name ?? "", entry?.FullName ?? "", entry?.Username ?? "");
        }

        var extra = due.Count - open.Count;
        if (extra > 0)
        {
            more ??= new ReminderWindow(main.ShowNotifications);
            more.SetMore(extra);
        }
        else
        {
            more?.Close();
            more = null;
        }

        Stack();
        if (added) SystemSounds.Asterisk.Play();
    }

    void Dismiss(string id) => main.Write(d =>
    {
        if (d.Reminders.FirstOrDefault(r => r.Id == id) is { } reminder) reminder.DismissedAt = DateTime.UtcNow;
    });

    void Stack()
    {
        var area = SystemParameters.WorkArea;
        var bottom = area.Bottom - Edge;
        foreach (var w in open.Values.Append(more).OfType<ReminderWindow>())
        {
            bottom -= w.Height;
            w.Left = area.Right - w.Width - Edge;
            w.Top = bottom;
            bottom -= Gap;
            if (!w.IsVisible) w.Show();
        }
    }
}
