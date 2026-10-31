using EasyPass.Core;

namespace EasyPass.App;

// Public: WPF bindings do not see internal types.
public sealed record TaskMark(string Name, bool Done)
{
    public string Glyph => Done ? "●" : "◐";
}

public sealed record MonthMarks(string Month, IReadOnlyList<TaskMark> Tasks)
{
    /// <summary>Tasks in list order, archived ones under their name. Null when nothing is marked.</summary>
    public static MonthMarks? Of(List<WorkTask> tasks, string monthName, IReadOnlyDictionary<string, string> statuses)
    {
        var marks = tasks.Where(t => statuses.ContainsKey(t.Id)).Select(t => new TaskMark(t.Name, statuses[t.Id] == Work.Done)).ToList();
        return marks.Count == 0 ? null : new MonthMarks(monthName, marks);
    }
}

public sealed record TodoItem(string Id, string Title, string Login, string Group, IReadOnlyList<MonthMarks> Months);

public sealed record NotificationItem(string EntryId, string Task, string Customer, string Login, string Time, string State, string Group);

public sealed record DrawerItem(string EntryId, string Title, string Detail);
