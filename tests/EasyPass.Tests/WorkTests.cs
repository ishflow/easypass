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
        var both = new HashSet<string> { "1", "2" };
        Assert.Equal("partial", Work.MonthStatus(work, new Entry { Id = "a" }, M, both));
        Assert.Equal("done", Work.MonthStatus(work, new Entry { Id = "b" }, M, both));
        Assert.Null(Work.MonthStatus(work, new Entry { Id = "c" }, M, both));
        Assert.Equal("done", Work.MonthStatus(work, new Entry { Id = "a" }, M, new HashSet<string> { "1" })); // an archived task does not count
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

    // §7d: tasks per customer

    [Fact]
    public void Assign_replaces_the_list_instead_of_changing_it()
    {
        Work.Assign(_d, _a.Id, [_t1.Id], Now);
        var first = _a.TaskIds!;
        Work.Assign(_d, _a.Id, [_t2.Id], Now);
        Assert.Equal([_t1.Id], first); // Entry.Clone shares the list
        Assert.Equal([_t2.Id], _a.TaskIds);
        Assert.Null(_b.TaskIds);
    }

    [Fact]
    public void Assign_rejects_unknown_archived_duplicate_empty_and_missing_customer()
    {
        var archived = new WorkTask { Name = "x", Archived = true };
        _d.Tasks.Add(archived);
        foreach (var call in new Action[]
        {
            () => Work.Assign(_d, _a.Id, ["nope"], Now),
            () => Work.Assign(_d, _a.Id, [_t1.Id, archived.Id], Now),
            () => Work.Assign(_d, _a.Id, [_t1.Id, _t1.Id], Now),
            () => Work.Assign(_d, _a.Id, [], Now),
            () => Work.Assign(_d, "no-entry", [_t1.Id], Now),
        })
            Assert.Equal("bad_request", Assert.Throws<ArgumentException>(call).Message);
        Assert.Null(_a.TaskIds);
    }

    [Fact]
    public void Assign_keeps_records_and_resolves_open_reminders_of_removed_tasks_in_any_month()
    {
        Save(_a, "2026-10", S((_t2.Id, "partial")), R((_t2.Id, Now.AddHours(1))));
        Save(_a, M, S((_t1.Id, "partial"), (_t2.Id, "partial")), R((_t1.Id, Now.AddHours(1)), (_t2.Id, Now.AddHours(1))));
        Save(_b, M, S((_t2.Id, "partial")), R((_t2.Id, Now.AddHours(1))));

        Work.Assign(_d, _a.Id, [_t1.Id], Now.AddMinutes(1)); // the first choice removes too: there was no list before it

        Assert.Equal("partial", _d.Work.Single(w => w.EntryId == _a.Id && w.Month == M).Tasks[_t2.Id]);
        Assert.Equal("partial", _d.Work.Single(w => w.EntryId == _a.Id && w.Month == "2026-10").Tasks[_t2.Id]);
        Assert.All(_d.Reminders.Where(r => r.EntryId == _a.Id && r.TaskId == _t2.Id), r => Assert.Equal(Now.AddMinutes(1), r.ResolvedAt));
        Assert.Null(_d.Reminders.Single(r => r.EntryId == _a.Id && r.TaskId == _t1.Id).ResolvedAt); // still chosen
        Assert.Null(_d.Reminders.Single(r => r.EntryId == _b.Id).ResolvedAt); // another customer
    }

    [Fact]
    public void TasksOf_is_the_chosen_active_tasks_in_pool_order()
    {
        Assert.Empty(Work.TasksOf(_d, _a)); // not chosen
        Work.Assign(_d, _a.Id, [_t2.Id, _t1.Id], Now);
        Assert.Equal([_t1, _t2], Work.TasksOf(_d, _a));
        Work.ArchiveTask(_d, _t1.Id, Now);
        Assert.Equal([_t2], Work.TasksOf(_d, _a));
        _d.Tasks.Add(new WorkTask { Name = "новая" }); // a new task does not join existing lists by itself
        Assert.Equal([_t2], Work.TasksOf(_d, _a));
    }

    [Fact]
    public void Save_with_a_list_accepts_only_the_customers_own_active_tasks()
    {
        Work.Assign(_d, _a.Id, [_t1.Id], Now);
        foreach (var call in new Action[]
        {
            () => Save(_a, M, S((_t2.Id, "done"))),
            () => Save(_a, M, S((_t1.Id, "partial"), (_t2.Id, "partial")), R((_t2.Id, Now.AddHours(1)))),
        })
            Assert.Equal("bad_request", Assert.Throws<ArgumentException>(call).Message);
        Assert.Empty(_d.Work);

        Save(_a, M, S((_t1.Id, "done")));
        Save(_b, M, S((_t2.Id, "done"))); // no list: every active task, as before
        Assert.Equal(2, _d.Work.Count);
    }

    [Fact]
    public void Save_keeps_the_history_of_tasks_removed_from_the_list()
    {
        Save(_a, M, S((_t1.Id, "done"), (_t2.Id, "done")));
        Work.Assign(_d, _a.Id, [_t1.Id], Now);
        Save(_a, M, S((_t1.Id, "partial")));
        Assert.Equal("done", Assert.Single(_d.Work).Tasks[_t2.Id]);
        Save(_a, M, S()); // grey on all of the list: the record lives on for what is left
        Assert.Equal(_t2.Id, Assert.Single(Assert.Single(_d.Work).Tasks).Key);
    }

    [Fact]
    public void Archiving_the_only_chosen_task_reads_as_not_chosen()
    {
        Work.Assign(_d, _a.Id, [_t1.Id], Now);
        Work.ArchiveTask(_d, _t1.Id, Now);
        Assert.Empty(Work.TasksOf(_d, _a));
        Save(_a, M, S((_t2.Id, "done"))); // would otherwise refuse everything, with a panel that shows nothing
        Assert.Equal(TodoGroup.Done, Assert.Single(Work.Todo(_d, M).Rows).Group);
    }

    [Fact]
    public void Todo_groups_follow_the_customers_list()
    {
        var c = new Entry { Username = "c" };
        var noList = new Entry { Username = "n" };
        _d.Entries.AddRange([c, noList]);
        foreach (var e in new[] { _a, _b, c }) Work.Assign(_d, e.Id, [_t1.Id, _t2.Id], Now);

        Save(_a, M, S((_t1.Id, "done"), (_t2.Id, "done")));     // all green
        Save(_b, M, S((_t1.Id, "done")));                       // the old rule would call this done
        Save(c, "2026-10", S((_t1.Id, "done")));                // nothing marked this month
        Save(noList, M, S((_t1.Id, "done")));                   // old rule: green, no orange

        Assert.Equal(TodoGroup.Done, Group(_a));
        Assert.Equal(TodoGroup.Unfinished, Group(_b));
        Assert.Equal(TodoGroup.NotStarted, Group(c));
        Assert.Equal(TodoGroup.Done, Group(noList));

        Assert.Equal("done", Status(_a));
        Assert.Equal("partial", Status(_b));
        Assert.Null(Status(c));
        Assert.Equal("done", Status(noList));

        var t = Work.Todo(_d, M);
        Assert.Equal((2, 1, 1), (t.Done, t.Unfinished, t.NotStarted));

        TodoGroup Group(Entry e) => Work.Todo(_d, M).Rows.Single(r => r.Entry == e).Group;
        string? Status(Entry e) => Work.MonthStatus(_d.Work, e, M, _d.Tasks.Where(x => !x.Archived).Select(x => x.Id).ToHashSet());
    }

    [Fact]
    public void Todo_lists_a_customer_with_a_list_and_no_record_as_not_started()
    {
        var hidden = new Entry { Username = "h" };
        var gone = new Entry { Username = "g" };
        var deleted = new WorkTask { Name = "x" };
        _d.Tasks.Add(deleted);
        _d.Entries.AddRange([hidden, gone]);
        Work.Assign(_d, _a.Id, [_t1.Id], Now);
        Work.Assign(_d, hidden.Id, [_t1.Id], Now);
        hidden.TodoHidden = true;
        Work.Assign(_d, gone.Id, [deleted.Id], Now);
        Work.ArchiveTask(_d, deleted.Id, Now); // no active task left on the list: not chosen, no record, not listed

        var t = Work.Todo(_d, M);
        var row = Assert.Single(t.Rows); // _b has neither a list nor a record
        Assert.Equal((_a, TodoGroup.NotStarted, (string?)null), (row.Entry, row.Group, row.LastMonth));
        Assert.Empty(row.ThisTasks);
        Assert.Empty(row.LastTasks);
        Assert.Equal((0, 0, 1), (t.Done, t.Unfinished, t.NotStarted));
    }

    [Fact]
    public void Todo_ignores_removed_and_archived_tasks_of_a_list()
    {
        Save(_a, M, S((_t2.Id, "done")));                      // removed afterwards: only t1 is left and it is grey
        Work.Assign(_d, _a.Id, [_t1.Id], Now);
        Save(_b, M, S((_t1.Id, "done"), (_t2.Id, "partial"))); // t2 archived afterwards: only green t1 is left
        Work.Assign(_d, _b.Id, [_t1.Id, _t2.Id], Now);
        Work.ArchiveTask(_d, _t2.Id, Now);

        var t = Work.Todo(_d, M);
        Assert.Equal(TodoGroup.NotStarted, t.Rows.Single(r => r.Entry == _a).Group);
        Assert.Equal(TodoGroup.Done, t.Rows.Single(r => r.Entry == _b).Group);
    }

    [Fact]
    public void Todo_row_shows_this_month_through_the_list_and_keeps_past_months()
    {
        Save(_a, "2026-10", S((_t2.Id, "done")));
        Save(_a, M, S((_t1.Id, "done"), (_t2.Id, "partial")));
        Work.Assign(_d, _a.Id, [_t1.Id], Now);

        var row = Assert.Single(Work.Todo(_d, M).Rows);
        Assert.Equal(_t1.Id, Assert.Single(row.ThisTasks).Key); // what the group counted, no orange beside "done"
        Assert.Equal("done", row.LastTasks[_t2.Id]);            // history
        Assert.Equal(2, _d.Work.Single(w => w.Month == M).Tasks.Count); // the record itself is untouched
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
