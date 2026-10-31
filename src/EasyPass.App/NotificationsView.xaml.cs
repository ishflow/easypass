using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using EasyPass.Core;
using static EasyPass.App.Loc;

namespace EasyPass.App;

public partial class NotificationsView : UserControl
{
    internal MainWindow Main = null!;

    public NotificationsView() => InitializeComponent();

    public void Refresh()
    {
        if (Main.ActiveVault is not { } vault) return;
        var d = vault.Data;
        var now = DateTime.UtcNow;
        var culture = Culture;
        var tasks = d.Tasks.Where(t => !t.Archived).ToDictionary(t => t.Id, t => t.Name);
        var entries = d.Entries.ToDictionary(e => e.Id);
        var planned = Work.Planned(d, now).ToList();
        var plannedIds = planned.Select(r => r.Id).ToHashSet();
        // Work.Due leaves out dismissed and completed ones, and this screen lists those too (spec §5)
        var past = d.Reminders.Where(r => !plannedIds.Contains(r.Id) && tasks.ContainsKey(r.TaskId) && entries.ContainsKey(r.EntryId))
            .OrderByDescending(r => r.DueAt);

        NotificationItem Item(Reminder r, string group, bool isPlanned)
        {
            var entry = entries[r.EntryId];
            var state = r.ResolvedAt != null ? L("NotifResolved") : r.DismissedAt != null ? L("NotifDismissed") : "";
            return new NotificationItem(r.EntryId, tasks[r.TaskId], entry.FullName, entry.Username, r.DueAt.ToLocalTime().ToString("g", culture), state, group, isPlanned, r.ResolvedAt != null);
        }
        var (dueName, plannedName) = (L("NotifDue"), L("NotifPlanned"));
        var items = past.Select(r => Item(r, dueName, false)).Concat(planned.Select(r => Item(r, plannedName, true))).ToList();

        var view = new ListCollectionView(items);
        view.GroupDescriptions.Add(new PropertyGroupDescription(nameof(NotificationItem.Group)));
        NotificationList.ItemsSource = view;
        EmptyText.Visibility = items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    void Row_Click(object sender, MouseButtonEventArgs e) => Open(sender);

    void Row_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter) Open(sender);
    }

    void Open(object row)
    {
        if (((ListBoxItem)row).DataContext is NotificationItem item) Main.OpenEntry(item.EntryId);
    }
}
