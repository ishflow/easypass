using System.Globalization;

namespace EasyPass.Core;

public enum TodoGroup { NotStarted, Unfinished, Done }
public sealed record TodoRow(Entry Entry, TodoGroup Group, string? LastMonth, IReadOnlyDictionary<string, string> LastTasks, IReadOnlyDictionary<string, string> ThisTasks);
public sealed record TodoList(IReadOnlyList<TodoRow> Rows, int Done, int Unfinished, int NotStarted);

// The monthly work rules, spec §3, §6, §7d, §8. Pure: callers run the changing ones inside Vault.Update.
public static class Work
{
    public const string Done = "done", Partial = "partial";
    const string MonthFormat = "yyyy-MM";
    static readonly char[] Quotes = ['"', '«', '»', '“', '”', '„'];
    static readonly string[] CompanyForms = ["ОсОО", "ОАО", "ЗАО", "ИП"];

    public static string MonthOf(DateTime local) => local.ToString(MonthFormat, CultureInfo.InvariantCulture);

    public static bool IsMonth(string s) =>
        DateTime.TryParseExact(s, MonthFormat, CultureInfo.InvariantCulture, DateTimeStyles.None, out _);

    /// <summary>The to-do group as a dot: "done", "partial", or null for not started.</summary>
    public static string? MonthStatus(IEnumerable<WorkRecord> work, Entry entry, string month, IReadOnlySet<string> activeTasks)
    {
        var record = work.FirstOrDefault(w => w.EntryId == entry.Id && w.Month == month);
        return record is null ? null : GroupOf(Chosen(entry, activeTasks), record.Tasks, activeTasks) switch
        {
            TodoGroup.Done => Done,
            TodoGroup.Unfinished => Partial,
            _ => null,
        };
    }

    // null = no list in effect: never chosen, or every chosen task deleted since (the customer is asked again)
    static List<string>? Chosen(Entry e, IReadOnlySet<string> active) =>
        e.TaskIds?.Where(active.Contains).ToList() is { Count: > 0 } ids ? ids : null;

    static TodoGroup GroupOf(List<string>? chosen, IReadOnlyDictionary<string, string> tasks, IReadOnlySet<string> active)
    {
        if (chosen is null)
            return Status(tasks, active) switch { Partial => TodoGroup.Unfinished, Done => TodoGroup.Done, _ => TodoGroup.NotStarted };
        return chosen.All(t => tasks.GetValueOrDefault(t) == Done) ? TodoGroup.Done
            : chosen.Any(tasks.ContainsKey) ? TodoGroup.Unfinished : TodoGroup.NotStarted;
    }

    static string? Better(string? a, string? b) => a == Partial || b == Partial ? Partial : a ?? b;

    static string? Status(IReadOnlyDictionary<string, string> tasks, IReadOnlySet<string> active)
    {
        string? status = null;
        foreach (var (task, value) in tasks)
            if (active.Contains(task))
                status = Better(status, value);
        return status;
    }

    internal static HashSet<string> ActiveTasks(VaultData d) => [.. d.Tasks.Where(t => !t.Archived).Select(t => t.Id)];

    // what a panel for this customer deals with; anything else in a record is history
    internal static ICollection<string> OwnTasks(Entry e, HashSet<string> active) => (ICollection<string>?)Chosen(e, active) ?? active;

    /// <summary>The customer's chosen active tasks in pool order; empty when no list is in effect (ask for one).</summary>
    public static IReadOnlyList<WorkTask> TasksOf(VaultData d, Entry entry) =>
        entry.TaskIds is { } ids ? [.. d.Tasks.Where(t => !t.Archived && ids.Contains(t.Id))] : [];

    /// <summary>Replaces the customer's list. Records stay; open reminders of tasks off the list close, in any month.</summary>
    public static void Assign(VaultData d, string entryId, IReadOnlyList<string> taskIds, DateTime nowUtc)
    {
        var active = ActiveTasks(d);
        if (d.Entries.FirstOrDefault(e => e.Id == entryId) is not { } entry || taskIds.Count == 0
            || taskIds.Distinct().Count() != taskIds.Count || !taskIds.All(active.Contains))
            throw new ArgumentException("bad_request");
        entry.TaskIds = [.. taskIds];
        foreach (var r in d.Reminders)
            if (r.EntryId == entryId && r.ResolvedAt is null && !taskIds.Contains(r.TaskId))
                r.ResolvedAt = nowUtc;
    }

    public static void Save(VaultData d, string entryId, string month, IReadOnlyDictionary<string, string> statuses,
        IReadOnlyDictionary<string, DateTime> reminders, DateTime nowUtc)
    {
        if (d.Entries.FirstOrDefault(e => e.Id == entryId) is not { } entry) throw new ArgumentException("bad_request");
        var own = OwnTasks(entry, ActiveTasks(d));
        if (!IsMonth(month)
            || statuses.Any(s => !own.Contains(s.Key) || s.Value is not (Done or Partial))
            || reminders.Keys.Any(t => statuses.GetValueOrDefault(t) != Partial))
            throw new ArgumentException("bad_request");

        var record = d.Work.FirstOrDefault(w => w.EntryId == entryId && w.Month == month);
        // the panel only knows the customer's own active tasks: what was done under an archived or removed one stays in the history
        var tasks = record is null ? [] : record.Tasks.Where(t => !own.Contains(t.Key)).ToDictionary();
        foreach (var (task, status) in statuses) tasks[task] = status;
        if (tasks.Count == 0)
        {
            if (record is not null) d.Work.Remove(record);
        }
        else
        {
            if (record is null) d.Work.Add(record = new WorkRecord { EntryId = entryId, Month = month });
            record.Tasks = tasks;
            record.UpdatedAt = nowUtc;
        }

        var existing = d.Reminders.Where(r => r.EntryId == entryId && r.Month == month).ToList();
        foreach (var r in existing)
            if (r.ResolvedAt is null && statuses.GetValueOrDefault(r.TaskId) != Partial)
                r.ResolvedAt = nowUtc;
        foreach (var (task, dueAt) in reminders)
        {
            var r = existing.FirstOrDefault(x => x.TaskId == task);
            if (r is null) d.Reminders.Add(r = new Reminder { EntryId = entryId, TaskId = task, Month = month });
            r.DueAt = dueAt;
            r.DismissedAt = r.ResolvedAt = null;
        }

        entry.TodoHidden = false;
    }

    public static void ArchiveTask(VaultData d, string taskId, DateTime nowUtc)
    {
        if (d.Tasks.FirstOrDefault(t => t.Id == taskId) is not { } task) return;
        task.Archived = true;
        foreach (var r in d.Reminders)
            if (r.TaskId == taskId && r.ResolvedAt is null)
                r.ResolvedAt = nowUtc;
    }

    public static void RemoveEntry(VaultData d, string entryId)
    {
        d.Entries.RemoveAll(e => e.Id == entryId);
        d.Work.RemoveAll(w => w.EntryId == entryId);
        d.Reminders.RemoveAll(r => r.EntryId == entryId);
    }

    /// <summary>Newest first.</summary>
    public static IEnumerable<Reminder> Due(VaultData d, DateTime nowUtc) =>
        Open(d).Where(r => r.DueAt <= nowUtc).OrderByDescending(r => r.DueAt);

    /// <summary>Soonest first.</summary>
    public static IEnumerable<Reminder> Planned(VaultData d, DateTime nowUtc) =>
        Open(d).Where(r => r.DueAt > nowUtc).OrderBy(r => r.DueAt);

    static IEnumerable<Reminder> Open(VaultData d)
    {
        var active = ActiveTasks(d);
        var entries = d.Entries.Select(e => e.Id).ToHashSet();
        return d.Reminders.Where(r => r.DismissedAt is null && r.ResolvedAt is null && active.Contains(r.TaskId) && entries.Contains(r.EntryId));
    }

    public static TodoList Todo(VaultData d, string month)
    {
        var active = ActiveTasks(d);
        var byEntry = new Dictionary<string, (WorkRecord? Last, WorkRecord? This)>(d.Entries.Count);
        foreach (var w in d.Work)
        {
            var order = string.CompareOrdinal(w.Month, month);
            if (order > 0) continue;
            byEntry.TryGetValue(w.EntryId, out var seen);
            if (order == 0) seen.This = w;
            else if (seen.Last is null || string.CompareOrdinal(w.Month, seen.Last.Month) > 0) seen.Last = w;
            byEntry[w.EntryId] = seen;
        }

        var rows = new List<TodoRow>();
        foreach (var e in d.Entries)
        {
            if (e.TodoHidden || !byEntry.TryGetValue(e.Id, out var seen)) continue;
            IReadOnlyDictionary<string, string> thisTasks = seen.This?.Tasks ?? [];
            var chosen = Chosen(e, active);
            var group = GroupOf(chosen, thisTasks, active);
            if (chosen is not null) thisTasks = thisTasks.Where(t => chosen.Contains(t.Key)).ToDictionary(); // what the group counted
            rows.Add(new TodoRow(e, group, seen.Last?.Month, seen.Last?.Tasks ?? [], thisTasks));
        }
        return new TodoList([.. rows.OrderBy(r => r.Group)],
            rows.Count(r => r.Group == TodoGroup.Done), rows.Count(r => r.Group == TodoGroup.Unfinished), rows.Count(r => r.Group == TodoGroup.NotStarted));
    }

    /// <summary>Null unless the text reads as a name (spec §8). Russian order: surname first; a company stays whole in LastName.</summary>
    public static (string LastName, string FirstName)? ParseName(string text)
    {
        var words = text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var name = string.Join(' ', words);
        if (words.Length < 2 || name.Length >= 100 || name.Any(char.IsDigit)) return null;
        var company = name.IndexOfAny(Quotes) >= 0 || CompanyForms.Contains(words[0], StringComparer.OrdinalIgnoreCase);
        return company ? (name, "") : (words[0], string.Join(' ', words[1..]));
    }
}
