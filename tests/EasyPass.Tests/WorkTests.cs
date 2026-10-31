using System.Globalization;
using EasyPass.Core;

namespace EasyPass.Tests;

public class WorkTests
{
    static readonly DateTime Now = new(2026, 11, 10, 8, 0, 0, DateTimeKind.Utc);
    const string M = "2026-11";

    readonly VaultData _d = new();
    readonly Entry _a = new() { Username = "93000000000789123" }, _b = new() { Username = "93000000000111" };
    readonly WorkTask _t1 = new() { Name = "Страховка" }, _t2 = new() { Name = "НДС" };

    public WorkTests()
    {
        _d.Entries.AddRange([_a, _b]);
        _d.Tasks.AddRange([_t1, _t2]);
    }

    static Dictionary<string, string> S(params (string Task, string Status)[] s) => s.ToDictionary(x => x.Task, x => x.Status);
    static Dictionary<string, DateTime> R(params (string Task, DateTime Due)[] r) => r.ToDictionary(x => x.Task, x => x.Due);

    void Save(Entry e, string month, Dictionary<string, string> statuses, Dictionary<string, DateTime>? reminders = null) =>
        Work.Save(_d, e.Id, month, statuses, reminders ?? [], Now);

    [Fact]
    public void MonthOf_uses_local_date()
    {
        Assert.Equal("2026-10", Work.MonthOf(new DateTime(2026, 10, 31, 23, 59, 0, DateTimeKind.Local)));
        Assert.Equal("2026-11", Work.MonthOf(new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Local)));
        var saved = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = new CultureInfo("th-TH"); // Buddhist calendar: year 2569 unless the format pins the calendar
        try { Assert.Equal("2026-11", Work.MonthOf(new DateTime(2026, 11, 1, 0, 0, 0, DateTimeKind.Local))); }
        finally { CultureInfo.CurrentCulture = saved; }
    }

    [Theory]
    [InlineData("2026-11", true)]
    [InlineData("2026-01", true)]
    [InlineData("2026-13", false)]
    [InlineData("2026-1", false)]
    [InlineData("26-11", false)]
    [InlineData(" 2026-11", false)]
    [InlineData("2026-11-01", false)]
    [InlineData("", false)]
    public void IsMonth_accepts_only_yyyy_MM(string s, bool expected) => Assert.Equal(expected, Work.IsMonth(s));

    [Fact]
    public void MonthStatus_partial_wins_over_done()
    {
        var work = new[]
        {
            new WorkRecord { EntryId = "a", Month = M, Tasks = new() { ["1"] = "done", ["2"] = "partial" } },
            new WorkRecord { EntryId = "b", Month = M, Tasks = new() { ["1"] = "done" } },
            new WorkRecord { EntryId = "c", Month = "2026-10", Tasks = new() { ["1"] = "partial" } },
        };
        Assert.Equal("partial", Work.MonthStatus(work, "a", M));
        Assert.Equal("done", Work.MonthStatus(work, "b", M));
        Assert.Null(Work.MonthStatus(work, "c", M));
        Assert.Equal("done", Work.MonthStatus(work, "a", M, new HashSet<string> { "1" })); // an archived task does not count
    }

    [Fact]
    public void Save_rejects_unknown_task_and_bad_status()
    {
        _t2.Archived = true;
        foreach (var call in new Action[]
        {
            () => Save(_a, M, S(("nope", "done"))),
            () => Save(_a, M, S((_t2.Id, "done"))),
            () => Save(_a, M, S((_t1.Id, "grey"))),
            () => Save(_a, "2026-13", S((_t1.Id, "done"))),
            () => Work.Save(_d, "no-entry", M, S((_t1.Id, "done")), R(), Now),
            () => Save(_a, M, S((_t1.Id, "partial")), R(("nope", Now.AddHours(2)))),
            () => Save(_a, M, S((_t1.Id, "done")), R((_t1.Id, Now.AddHours(2)))), // a reminder is only for an orange task
        })
            Assert.Equal("bad_request", Assert.Throws<ArgumentException>(call).Message);
        Assert.Empty(_d.Work);
        Assert.Empty(_d.Reminders);
    }

    [Fact]
    public void Save_partial_creates_single_reminder_and_reset_clears_dismissed()
    {
        Save(_a, M, S((_t1.Id, "partial")), R((_t1.Id, Now.AddHours(2))));
        var r = Assert.Single(_d.Reminders);
        Assert.Equal((_a.Id, _t1.Id, M, Now.AddHours(2)), (r.EntryId, r.TaskId, r.Month, r.DueAt));
        var w = Assert.Single(_d.Work);
        Assert.Equal((_a.Id, M, "partial", Now), (w.EntryId, w.Month, w.Tasks[_t1.Id], w.UpdatedAt));

        r.DismissedAt = Now;
        Save(_a, M, S((_t1.Id, "partial"))); // no new time: an orange task whose reminder was closed stays closed
        Assert.Same(r, Assert.Single(_d.Reminders));
        Assert.Equal(Now, r.DismissedAt);
        Assert.Equal(Now.AddHours(2), r.DueAt);

        Save(_a, M, S((_t1.Id, "partial")), R((_t1.Id, Now.AddDays(1))));
        Assert.Same(r, Assert.Single(_d.Reminders));
        Assert.Equal(Now.AddDays(1), r.DueAt);
        Assert.Null(r.DismissedAt);
        Assert.Single(_d.Work);
    }

    [Fact]
    public void Save_done_resolves_open_reminder()
    {
        Save(_a, M, S((_t1.Id, "partial"), (_t2.Id, "partial")), R((_t1.Id, Now.AddHours(2)), (_t2.Id, Now.AddHours(5))));
        Save(_a, M, S((_t1.Id, "done"), (_t2.Id, "partial")));
        Assert.Equal(Now, _d.Reminders.Single(r => r.TaskId == _t1.Id).ResolvedAt);
        Assert.Null(_d.Reminders.Single(r => r.TaskId == _t2.Id).ResolvedAt);

        Save(_a, M, S((_t1.Id, "done"))); // t2 grey now
        Assert.Equal(Now, _d.Reminders.Single(r => r.TaskId == _t2.Id).ResolvedAt);
    }

    [Fact]
    public void Save_new_time_reopens_a_resolved_reminder()
    {
        Save(_a, M, S((_t1.Id, "partial")), R((_t1.Id, Now.AddHours(2))));
        Save(_a, M, S((_t1.Id, "done")));
        Save(_a, M, S((_t1.Id, "partial")), R((_t1.Id, Now.AddHours(5))));
        var r = Assert.Single(_d.Reminders);
        Assert.Null(r.ResolvedAt);
        Assert.Single(Work.Due(_d, Now.AddHours(5)));
    }

    [Fact]
    public void Save_touches_only_that_customer_and_month()
    {
        Save(_a, "2026-10", S((_t1.Id, "partial")), R((_t1.Id, Now.AddHours(1))));
        Save(_b, M, S((_t1.Id, "partial")), R((_t1.Id, Now.AddHours(1))));
        Save(_a, M, S((_t1.Id, "done")));
        Assert.Equal(3, _d.Work.Count);
        Assert.All(_d.Reminders, r => Assert.Null(r.ResolvedAt));
    }

    [Fact]
    public void Save_empty_removes_record_and_unhides_todo()
    {
        Save(_a, M, S((_t1.Id, "partial")), R((_t1.Id, Now.AddHours(2))));
        _a.TodoHidden = true;
        Save(_a, M, S());
        Assert.Empty(_d.Work);
        Assert.False(_a.TodoHidden);
        Assert.Equal(Now, Assert.Single(_d.Reminders).ResolvedAt);
    }

    [Fact]
    public void Save_keeps_the_history_of_archived_tasks()
    {
        // the panel no longer sends an archived task: saving must not erase what was done under it
        Save(_a, M, S((_t1.Id, "done"), (_t2.Id, "done")));
        Work.ArchiveTask(_d, _t2.Id, Now);
        Save(_a, M, S((_t1.Id, "partial")));
        Assert.Equal("done", Assert.Single(_d.Work).Tasks[_t2.Id]);
        Save(_a, M, S());
        Assert.Equal(_t2.Id, Assert.Single(Assert.Single(_d.Work).Tasks).Key);
    }

    [Fact]
    public void ArchiveTask_resolves_reminders_and_hides_from_panel()
    {
        Save(_a, M, S((_t1.Id, "partial"), (_t2.Id, "partial")), R((_t1.Id, Now.AddHours(-1)), (_t2.Id, Now.AddHours(-1))));
        Work.ArchiveTask(_d, _t1.Id, Now.AddMinutes(1));
        Assert.True(_t1.Archived);
        Assert.False(_t2.Archived);
        Assert.Equal(Now.AddMinutes(1), _d.Reminders.Single(r => r.TaskId == _t1.Id).ResolvedAt);
        Assert.Equal(_t2.Id, Assert.Single(Work.Due(_d, Now)).TaskId);
        Assert.Throws<ArgumentException>(() => Save(_a, M, S((_t1.Id, "done"))));
        Assert.Equal("partial", _d.Work[0].Tasks[_t1.Id]); // history keeps it

        Work.ArchiveTask(_d, "nope", Now); // already gone on the other computer: nothing to do
    }

    [Fact]
    public void RemoveEntry_cascades()
    {
        Save(_a, M, S((_t1.Id, "partial")), R((_t1.Id, Now.AddHours(2))));
        Save(_b, M, S((_t1.Id, "partial")), R((_t1.Id, Now.AddHours(2))));
        Work.RemoveEntry(_d, _a.Id);
        Assert.Equal(_b.Id, Assert.Single(_d.Entries).Id);
        Assert.Equal(_b.Id, Assert.Single(_d.Work).EntryId);
        Assert.Equal(_b.Id, Assert.Single(_d.Reminders).EntryId);
    }

    Reminder AddReminder(string entryId, string taskId, DateTime due)
    {
        var r = new Reminder { EntryId = entryId, TaskId = taskId, Month = M, DueAt = due };
        _d.Reminders.Add(r);
        return r;
    }

    [Fact]
    public void Due_skips_dismissed_resolved_archived_missing_entry()
    {
        var old = AddReminder(_a.Id, _t1.Id, Now.AddHours(-3));
        var recent = AddReminder(_b.Id, _t1.Id, Now.AddHours(-1));
        var exact = AddReminder(_b.Id, _t2.Id, Now);
        AddReminder(_a.Id, _t1.Id, Now.AddHours(-1)).DismissedAt = Now;
        AddReminder(_a.Id, _t1.Id, Now.AddHours(-1)).ResolvedAt = Now;
        AddReminder("gone", _t1.Id, Now.AddHours(-1));
        var archived = new WorkTask { Name = "x", Archived = true };
        _d.Tasks.Add(archived);
        AddReminder(_a.Id, archived.Id, Now.AddHours(-1));
        var later = AddReminder(_a.Id, _t2.Id, Now.AddHours(1));
        var latest = AddReminder(_b.Id, _t1.Id, Now.AddHours(2));

        Assert.Equal([exact, recent, old], Work.Due(_d, Now)); // newest first
        Assert.Equal([later, latest], Work.Planned(_d, Now)); // soonest first
    }

    [Fact]
    public void Todo_groups_counts_and_skipped_month_keeps_customer()
    {
        var c = new Entry { Username = "c" };
        var never = new Entry { Username = "never" };
        var future = new Entry { Username = "future" };
        _d.Entries.AddRange([c, never, future]);
        Save(_a, "2026-09", S((_t1.Id, "done")));       // skipped October, nothing in November → still listed
        Save(_a, "2026-08", S((_t2.Id, "partial")));
        Save(_b, "2026-10", S((_t1.Id, "partial")));
        Save(_b, M, S((_t1.Id, "done"), (_t2.Id, "partial")));
        Save(c, M, S((_t1.Id, "done")));                // first work ever is this month
        Save(future, "2026-12", S((_t1.Id, "done")));   // not yet relevant to November

        var t = Work.Todo(_d, M);
        Assert.Equal((1, 1, 1), (t.Done, t.Unfinished, t.NotStarted));
        Assert.Equal([_a.Id, _b.Id, c.Id], t.Rows.Select(r => r.Entry.Id)); // NotStarted, Unfinished, Done

        var a = t.Rows[0];
        Assert.Equal((TodoGroup.NotStarted, "2026-09"), (a.Group, a.LastMonth));
        Assert.Equal("done", a.LastTasks[_t1.Id]);
        Assert.Empty(a.ThisTasks);

        var b = t.Rows[1];
        Assert.Equal((TodoGroup.Unfinished, "2026-10"), (b.Group, b.LastMonth));
        Assert.Equal("partial", b.ThisTasks[_t2.Id]);

        var rowC = t.Rows[2];
        Assert.Equal((TodoGroup.Done, (string?)null), (rowC.Group, rowC.LastMonth));
        Assert.Empty(rowC.LastTasks);

        Assert.Empty(Work.Todo(_d, "2026-07").Rows); // earlier months only know what had happened by then
    }

    [Fact]
    public void Todo_does_not_count_archived_tasks()
    {
        Save(_a, M, S((_t2.Id, "partial")));
        Save(_b, M, S((_t1.Id, "done"), (_t2.Id, "partial")));
        Work.ArchiveTask(_d, _t2.Id, Now);

        var t = Work.Todo(_d, M);
        Assert.Equal((1, 0, 1), (t.Done, t.Unfinished, t.NotStarted));
        Assert.Equal(TodoGroup.NotStarted, t.Rows.Single(r => r.Entry.Id == _a.Id).Group);
        Assert.Equal(TodoGroup.Done, t.Rows.Single(r => r.Entry.Id == _b.Id).Group);
    }

    [Fact]
    public void Todo_hidden_customer_returns_after_new_work()
    {
        Save(_a, "2026-10", S((_t1.Id, "done")));
        _a.TodoHidden = true;
        Assert.Empty(Work.Todo(_d, M).Rows);
        Save(_a, M, S((_t1.Id, "done")));
        Assert.Equal(_a.Id, Assert.Single(Work.Todo(_d, M).Rows).Entry.Id);
    }

    [Theory]
    [InlineData("Абдылдаева Чолпон Бакытовна", "Абдылдаева", "Чолпон Бакытовна")]
    [InlineData("  Иванов   Иван ", "Иванов", "Иван")]
    [InlineData("ОсОО \"Ак-Жол\"", "ОсОО \"Ак-Жол\"", "")]
    [InlineData("ОСОО Ак Жол", "ОСОО Ак Жол", "")]
    [InlineData("ОАО Банк", "ОАО Банк", "")]
    [InlineData("ЗАО Банк", "ЗАО Банк", "")]
    [InlineData("ИП Иванов Иван", "ИП Иванов Иван", "")]
    [InlineData("\"Ак Жол\" ОсОО", "\"Ак Жол\" ОсОО", "")]
    [InlineData("«Ак Жол» фирма", "«Ак Жол» фирма", "")]
    [InlineData("Ипатов Иван", "Ипатов", "Иван")] // begins with the letters of ИП but is a surname
    [InlineData("Иванов", null, null)]
    [InlineData("Иванов 123", null, null)]
    [InlineData("ОсОО Ак-Жол 7", null, null)]
    [InlineData("\"Ак-Жол\"", null, null)]
    [InlineData("", null, null)]
    [InlineData("   ", null, null)]
    public void ParseName_rules(string text, string? last, string? first) =>
        Assert.Equal(last is null ? null : (last, first!), Work.ParseName(text));

    [Fact]
    public void ParseName_length_limit_is_under_100()
    {
        Assert.NotNull(Work.ParseName("Иванов " + new string('я', 92)));  // 99
        Assert.Null(Work.ParseName("Иванов " + new string('я', 93)));     // 100
    }
}
