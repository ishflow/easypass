using System.Text.Json.Nodes;
using EasyPass.Core;
using EasyPass.Host;

namespace EasyPass.Tests;

[Collection("settings")]
public class HostApiTests : IDisposable
{
    readonly TempDir _tmp = new();
    readonly Vault _v;
    readonly string _ahmetId, _ahmetYId;
    public void Dispose() => _tmp.Dispose();

    public HostApiTests()
    {
        _v = Vault.Create(_tmp.File(), "pw");
        var ahmet = new Entry { Site = "x.com", FirstName = "Ahmet", LastName = "Yılmaz", Extra1 = "e1", Extra2 = "e2", Username = "ahmet", Password = "p1" };
        var ahmetY = new Entry { Site = "y.com", FirstName = "Ahmet", LastName = "Yılmaz", Username = "ahmet", Password = "py" };
        (_ahmetId, _ahmetYId) = (ahmet.Id, ahmetY.Id);
        _v.Update(l => l.AddRange([
            ahmet,
            ahmetY,
            new Entry { Site = "x.com", FirstName = "Ali", LastName = "Kaya", Username = "ortak", Password = "x" },
            new Entry { Site = "x.com", FirstName = "Veli", LastName = "Can", Username = "ORTAK", Password = "y" },
            new Entry { Site = "y.com", FirstName = "Yalnız", LastName = "Y", Username = "sadecey", Password = "s" },
        ]));
    }

    JsonObject Call(string json) => HostApi.Handle(JsonNode.Parse(json)!.AsObject(), () => _v);

    [Fact]
    public void Locked_when_no_vault()
    {
        var r = HostApi.Handle(new JsonObject { ["id"] = 7, ["cmd"] = "status" }, () => null);
        Assert.Equal($$"""{"id":7,"ok":false,"error":"locked","lang":"{{AppPaths.Lang}}"}""", r.ToJsonString());
        // lang only on status
        r = HostApi.Handle(new JsonObject { ["id"] = 8, ["cmd"] = "search", ["site"] = "x.com", ["q"] = "" }, () => null);
        Assert.Equal("""{"id":8,"ok":false,"error":"locked"}""", r.ToJsonString());
    }

    [Fact]
    public void Status_returns_count()
    {
        var r = Call("""{"id":1,"cmd":"status"}""");
        Assert.Equal($$"""{"id":1,"ok":true,"locked":false,"count":5,"lang":"{{AppPaths.Lang}}"}""", r.ToJsonString());
    }

    [Fact]
    public void Search_returns_only_site_items_without_password()
    {
        var r = Call("""{"id":"a","cmd":"search","site":"portal.x.com","q":"ahm"}""");
        Assert.Equal("a", (string?)r["id"]);
        Assert.True((bool)r["ok"]!);
        var item = Assert.Single(r["items"]!.AsArray())!.AsObject();
        Assert.Equal(_ahmetId, (string?)item["id"]);
        Assert.Equal(("Ahmet", "Yılmaz", "e1", "e2", "ahmet"),
            ((string?)item["firstName"], (string?)item["lastName"], (string?)item["extra1"], (string?)item["extra2"], (string?)item["username"]));
        Assert.False(item.ContainsKey("password"));

        Assert.Empty(Call("""{"id":1,"cmd":"search","site":"x.com","q":"sadecey"}""")["items"]!.AsArray());
        Assert.Empty(Call("""{"id":1,"cmd":"search","site":"evilx.com","q":""}""")["items"]!.AsArray());
    }

    [Fact]
    public void Same_username_on_two_sites_gets_own_password()
    {
        string Pw(string site)
        {
            var found = Call($$"""{"id":1,"cmd":"search","site":"{{site}}","q":"ahmet"}""")["items"]!.AsArray();
            var id = (string)Assert.Single(found)!["id"]!;
            return (string)Call($$"""{"id":1,"cmd":"get","site":"{{site}}","entryId":"{{id}}"}""")["password"]!;
        }
        Assert.Equal("p1", Pw("x.com"));
        Assert.Equal("py", Pw("www.y.com"));
    }

    [Fact]
    public void Get_returns_credentials_only_for_matching_site()
    {
        var r = Call($$"""{"id":2,"cmd":"get","site":"x.com","entryId":"{{_ahmetId}}"}""");
        Assert.Equal("""{"id":2,"ok":true,"username":"ahmet","password":"p1"}""", r.ToJsonString());
        Assert.Equal("not_found", (string?)Call($$"""{"id":3,"cmd":"get","site":"x.com","entryId":"{{_ahmetYId}}"}""")["error"]);
        Assert.Equal("not_found", (string?)Call("""{"id":3,"cmd":"get","site":"x.com","entryId":"nope"}""")["error"]);
        Assert.Equal("bad_request", (string?)Call("""{"id":4,"cmd":"get","site":"x.com"}""")["error"]);
        Assert.Equal("bad_request", (string?)Call($$"""{"id":4,"cmd":"get","entryId":"{{_ahmetId}}"}""")["error"]);
    }

    [Fact]
    public void Check_same_changed_new_ambiguous()
    {
        var same = Call("""{"id":1,"cmd":"check","site":"x.com","username":"AHMET","password":"p1"}""");
        Assert.Equal("same", (string?)same["result"]);
        Assert.Equal(_ahmetId, (string?)same["entryId"]);

        var changed = Call("""{"id":1,"cmd":"check","site":"x.com","username":"ahmet","password":"p2"}""");
        Assert.Equal("changed", (string?)changed["result"]);
        Assert.Equal(_ahmetId, (string?)changed["entryId"]);
        Assert.Equal("Ahmet Yılmaz", (string?)changed["name"]);

        Assert.Equal("new", (string?)Call("""{"id":1,"cmd":"check","site":"x.com","username":"kimse","password":"p"}""")["result"]);
        Assert.Equal("ambiguous", (string?)Call("""{"id":1,"cmd":"check","site":"x.com","username":"ortak","password":"z"}""")["result"]);
        Assert.Equal("same", (string?)Call("""{"id":1,"cmd":"check","site":"x.com","username":"ortak","password":"y"}""")["result"]);
        // Y's username on X is unknown there
        Assert.Equal("new", (string?)Call("""{"id":1,"cmd":"check","site":"x.com","username":"sadecey","password":"s"}""")["result"]);
    }

    [Fact]
    public void Check_with_entryId_compares_that_entry_within_site()
    {
        // username differs (password-change form), entryId decides
        var r = Call($$"""{"id":1,"cmd":"check","site":"x.com","username":"baska","password":"yeni","entryId":"{{_ahmetId}}"}""");
        Assert.Equal("changed", (string?)r["result"]);
        Assert.Equal(_ahmetId, (string?)r["entryId"]);
        // unknown or other-site entryId falls back to username rule
        Assert.Equal("new", (string?)Call("""{"id":1,"cmd":"check","site":"x.com","username":"baska","password":"p","entryId":"nope"}""")["result"]);
        Assert.Equal("new", (string?)Call($$"""{"id":1,"cmd":"check","site":"x.com","username":"baska","password":"p","entryId":"{{_ahmetYId}}"}""")["result"]);
    }

    [Fact]
    public void Update_changes_password_on_disk_only_for_matching_site()
    {
        var r = Call($$"""{"id":5,"cmd":"update","site":"x.com","entryId":"{{_ahmetId}}","password":"p9"}""");
        Assert.Equal("""{"id":5,"ok":true}""", r.ToJsonString());
        Assert.Equal("p9", Vault.Open(_v.Path, _v.Key).Entries.Single(e => e.Id == _ahmetId).Password);
        Assert.Equal("not_found", (string?)Call("""{"id":6,"cmd":"update","site":"x.com","entryId":"nope","password":"p"}""")["error"]);
        Assert.Equal("not_found", (string?)Call($$"""{"id":6,"cmd":"update","site":"x.com","entryId":"{{_ahmetYId}}","password":"p"}""")["error"]);
        Assert.Equal("py", Vault.Open(_v.Path, _v.Key).Entries.Single(e => e.Id == _ahmetYId).Password);
    }

    [Fact]
    public void Failed_update_is_not_remembered_in_memory()
    {
        Directory.CreateDirectory(_v.Path + ".tmp"); // save fails
        var r = Call($$"""{"id":5,"cmd":"update","site":"x.com","entryId":"{{_ahmetId}}","password":"p9"}""");
        Assert.False((bool)r["ok"]!);
        // the extension must still be asked to save p9, and the host must hand out what is on disk
        Assert.Equal("changed", (string?)Call("""{"id":6,"cmd":"check","site":"x.com","username":"ahmet","password":"p9"}""")["result"]);
        Assert.Equal("p1", (string?)Call($$"""{"id":7,"cmd":"get","site":"x.com","entryId":"{{_ahmetId}}"}""")["password"]);
    }

    [Fact]
    public void Add_creates_entry_on_disk_with_normalized_site()
    {
        var r = Call("""{"id":8,"cmd":"add","site":"WWW.Portal.X.com","firstName":"Ayşe","lastName":"Su","username":"ayse","password":"s"}""");
        Assert.True((bool)r["ok"]!);
        var e = Vault.Open(_v.Path, _v.Key).Entries.Single(x => x.Id == (string?)r["entryId"]);
        Assert.Equal(("portal.x.com", "Ayşe", "Su", "ayse", "s"), (e.Site, e.FirstName, e.LastName, e.Username, e.Password));
    }

    [Fact]
    public void Site_is_required_for_search_check_add()
    {
        foreach (var json in new[]
        {
            """{"id":1,"cmd":"search","q":"a"}""",
            """{"id":1,"cmd":"search","site":"  ","q":"a"}""",
            """{"id":1,"cmd":"check","username":"ahmet","password":"p1"}""",
            """{"id":1,"cmd":"add","username":"u","password":"p"}""",
        })
            Assert.Equal("bad_request", (string?)Call(json)["error"]);
    }

    [Fact]
    public void App_write_is_seen_by_host_instance_on_next_request()
    {
        var app = Vault.Open(_v.Path, _v.Key);
        var host = Vault.Open(_v.Path, _v.Key);
        JsonObject Search() => HostApi.Handle(JsonNode.Parse("""{"id":1,"cmd":"search","site":"x.com","q":"zehra"}""")!.AsObject(),
            () => { host.ReloadIfChanged(); return host; });

        Assert.Empty(Search()["items"]!.AsArray());
        app.Update(l => l.Add(new Entry { Site = "x.com", FirstName = "Zehra", Username = "z", Password = "p" }));
        Assert.Equal("Zehra", (string?)Assert.Single(Search()["items"]!.AsArray())!["firstName"]);
    }

    [Fact]
    public void All_lists_every_site_with_its_site_but_no_password()
    {
        var items = Call("""{"id":1,"cmd":"all","q":""}""")["items"]!.AsArray();
        Assert.Equal(5, items.Count);
        foreach (var i in items)
            Assert.Equal(["extra1", "extra2", "firstName", "id", "lastName", "site", "username"], i!.AsObject().Select(p => p.Key).Order());
        Assert.Equal(["x.com", "y.com"], Call("""{"id":2,"cmd":"all","q":"ahmet"}""")["items"]!.AsArray().Select(i => (string?)i!["site"]).Order());
        Assert.Equal(2, Call("""{"id":3,"cmd":"all","q":"y.com"}""")["items"]!.AsArray().Count); // the site name is searchable
    }

    [Fact]
    public void Add_keeps_sign_up_fields_cleaned_and_capped()
    {
        var label = new string('L', 150);
        var added = Call($$"""
            {"id":1,"cmd":"add","site":"x.com","username":"nur","password":"p","fields":[
              {"label":" Telefon ","value":" 0532 ","secret":false},
              {"label":"TC kimlik no","value":"12345678901","secret":true},
              {"label":"{{label}}","value":"x","secret":"yes"},
              {"label":"Boş","value":"  "},
              "not an object",
              {"label":"Sayı","value":5}
            ]}
            """);
        var e = Call($$"""{"id":2,"cmd":"entry","entryId":"{{added["entryId"]}}"}""");
        var fields = e["fields"]!.AsArray().Select(f => ((string?)f!["label"], (string?)f["value"], (bool)f["secret"]!)).ToList();
        Assert.Equal([("Telefon", "0532", false), ("TC kimlik no", "12345678901", true), (label[..100], "x", false)], fields);
        Assert.Empty(Call("""{"id":3,"cmd":"entry","entryId":"__x__"}""".Replace("__x__", _ahmetId))["fields"]!.AsArray());
    }

    [Fact]
    public void Entry_returns_any_site_with_password()
    {
        var e = Call($$"""{"id":1,"cmd":"entry","entryId":"{{_ahmetYId}}"}""");
        Assert.Equal(("y.com", "ahmet", "py"), ((string?)e["site"], (string?)e["username"], (string?)e["password"]));
        Assert.Equal("not_found", (string?)Call("""{"id":2,"cmd":"entry","entryId":"nope"}""")["error"]);
        Assert.Equal("bad_request", (string?)Call("""{"id":3,"cmd":"entry"}""")["error"]);
    }

    [Fact]
    public void Unknown_or_malformed_is_bad_request()
    {
        Assert.Equal("""{"id":9,"ok":false,"error":"bad_request"}""", Call("""{"id":9,"cmd":"zzz"}""").ToJsonString());
        Assert.Equal("bad_request", (string?)Call("""{"id":9,"cmd":"add","site":"x.com","username":"u"}""")["error"]);
        Assert.Equal("bad_request", (string?)Call("""{"id":9,"cmd":"get","site":"x.com","entryId":5}""")["error"]);
        Assert.Equal("bad_request", (string?)Call("""{"id":9}""")["error"]);
    }

    static readonly string ThisMonth = Work.MonthOf(DateTime.Now), LastMonth = Work.MonthOf(DateTime.Now.AddMonths(-1));

    static string Iso(DateTime utc) => utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");

    (string T1, string T2, string Archived) AddTasks()
    {
        WorkTask t1 = new() { Name = "Страховка" }, t2 = new() { Name = "НДС" }, old = new() { Name = "Старая", Archived = true };
        _v.Update(d => d.Tasks.AddRange([t1, old, t2]));
        return (t1.Id, t2.Id, old.Id);
    }

    JsonObject SaveWork(string month, string statuses, string reminders = "{}", string? entryId = null, string site = "x.com") =>
        Call($$"""{"id":1,"cmd":"work_save","site":"{{site}}","entryId":"{{entryId ?? _ahmetId}}","month":"{{month}}","statuses":{{statuses}},"reminders":{{reminders}}}""");

    [Fact]
    public void Work_get_returns_tasks_statuses_reminders_without_password()
    {
        var (t1, t2, old) = AddTasks();
        var due = DateTime.UtcNow.AddHours(2);
        _v.Update(d =>
        {
            d.Work.Add(new WorkRecord { EntryId = _ahmetId, Month = ThisMonth, Tasks = new() { [t1] = "done", [t2] = "partial", [old] = "done" } });
            d.Reminders.Add(new Reminder { EntryId = _ahmetId, TaskId = t2, Month = ThisMonth, DueAt = due, DismissedAt = DateTime.UtcNow });
            d.Reminders.Add(new Reminder { EntryId = _ahmetId, TaskId = t1, Month = ThisMonth, DueAt = due, ResolvedAt = DateTime.UtcNow });
            d.Reminders.Add(new Reminder { EntryId = _ahmetYId, TaskId = t2, Month = ThisMonth, DueAt = due });
        });

        var r = Call($$"""{"id":3,"cmd":"work_get","site":"portal.x.com","entryId":"{{_ahmetId}}"}""");

        Assert.Equal(("ahmet", "Ahmet Yılmaz", ThisMonth), ((string?)r["username"], (string?)r["name"], (string?)r["month"]));
        Assert.False((bool)r["assigned"]!);
        Assert.Empty(r["tasks"]!.AsArray()); // nothing chosen yet
        Assert.Equal([t1, t2], r["allTasks"]!.AsArray().Select(t => (string?)t!["id"])); // no archived, insertion order
        Assert.Equal(["Страховка", "НДС"], r["allTasks"]!.AsArray().Select(t => (string?)t!["name"]));
        Assert.Equal([(t1, "done"), (t2, "partial")], r["statuses"]!.AsObject().Select(p => (p.Key, (string)p.Value!))); // saving back must not meet the archived id
        var rem = Assert.Single(r["reminders"]!.AsArray())!; // only this customer's open one
        Assert.Equal((t2, Iso(due), true), ((string?)rem["taskId"], (string?)rem["dueAt"], (bool)rem["dismissed"]!));

        Assert.DoesNotContain("password", r.ToJsonString());
        Assert.DoesNotContain("p1", r.ToJsonString());

        // a month chosen at login survives the turn of the month
        var other = Call($$"""{"id":3,"cmd":"work_get","site":"x.com","entryId":"{{_ahmetId}}","month":"2020-02"}""");
        Assert.Equal("2020-02", (string?)other["month"]);
        Assert.Empty(other["statuses"]!.AsObject());
        Assert.Empty(other["reminders"]!.AsArray());

        Assert.Equal("bad_request", (string?)Call($$"""{"id":3,"cmd":"work_get","site":"x.com","entryId":"{{_ahmetId}}","month":"2020-13"}""")["error"]);
        Assert.Equal("bad_request", (string?)Call($$"""{"id":3,"cmd":"work_get","site":"x.com","entryId":"{{_ahmetId}}","month":202011}""")["error"]);
        Assert.Equal("bad_request", (string?)Call("""{"id":3,"cmd":"work_get","site":"x.com"}""")["error"]);
        Assert.Equal("not_found", (string?)Call($$"""{"id":3,"cmd":"work_get","site":"x.com","entryId":"{{_ahmetYId}}"}""")["error"]);
    }

    [Fact]
    public void Work_save_stores_statuses_and_reminder()
    {
        var (t1, t2, _) = AddTasks();
        var due = DateTime.UtcNow.AddDays(2);
        var r = SaveWork(ThisMonth, $$"""{"{{t1}}":"done","{{t2}}":"partial"}""", $$"""{"{{t2}}":"{{Iso(due)}}"}""");
        Assert.Equal("""{"id":1,"ok":true}""", r.ToJsonString());

        var d = Vault.Open(_v.Path, _v.Key).Data;
        var w = Assert.Single(d.Work);
        Assert.Equal((_ahmetId, ThisMonth, "done", "partial"), (w.EntryId, w.Month, w.Tasks[t1], w.Tasks[t2]));
        var rem = Assert.Single(d.Reminders);
        Assert.Equal((t2, Iso(due)), (rem.TaskId, Iso(rem.DueAt)));
        Assert.True(SaveWork(LastMonth, $$"""{"{{t1}}":"done"}""")["ok"]!.GetValue<bool>()); // logged in on the 31st, saved on the 1st

        SaveWork(ThisMonth, "{}");
        Assert.Equal(LastMonth, Assert.Single(Vault.Open(_v.Path, _v.Key).Data.Work).Month);
        // an offset is turned into UTC
        SaveWork(ThisMonth, $$"""{"{{t1}}":"partial"}""", $$"""{"{{t1}}":"{{DateTime.UtcNow.AddDays(1):yyyy-MM-dd}}T12:00:00+06:00"}""");
        var offset = Vault.Open(_v.Path, _v.Key).Data.Reminders.Single(x => x.TaskId == t1);
        Assert.Equal((6, DateTimeKind.Utc), (offset.DueAt.Hour, offset.DueAt.Kind));
    }

    [Fact]
    public void Work_save_validates_month_window_and_due_range()
    {
        var (t1, _, old) = AddTasks();
        var partial = $$"""{"{{t1}}":"partial"}""";
        string Due(DateTime t) => $$"""{"{{t1}}":"{{Iso(t)}}"}""";
        var now = DateTime.UtcNow;

        foreach (var bad in new[]
        {
            SaveWork(Work.MonthOf(DateTime.Now.AddMonths(-2)), partial),   // older than last month
            SaveWork(Work.MonthOf(DateTime.Now.AddMonths(1)), partial),    // future
            SaveWork("2026-13", partial),
            SaveWork(ThisMonth, partial, Due(now.AddMinutes(-6))),         // past
            SaveWork(ThisMonth, partial, Due(now.AddDays(366))),           // over a year away
            SaveWork(ThisMonth, partial, $$"""{"{{t1}}":"tomorrow"}"""),
            SaveWork(ThisMonth, partial, $$"""{"{{t1}}":5}"""),
            SaveWork(ThisMonth, $$"""{"{{t1}}":"grey"}"""),
            SaveWork(ThisMonth, $$"""{"{{t1}}":1}"""),
            SaveWork(ThisMonth, """{"nope":"done"}"""),
            SaveWork(ThisMonth, $$"""{"{{old}}":"done"}"""),                // archived
            SaveWork(ThisMonth, "[]"),
            SaveWork(ThisMonth, partial, "[]"),
            SaveWork(ThisMonth, new JsonObject(Enumerable.Range(0, 201).Select(i => KeyValuePair.Create($"k{i}", (JsonNode?)"done"))).ToJsonString()),
            Call($$$"""{"id":1,"cmd":"work_save","site":"x.com","entryId":"{{{_ahmetId}}}","month":"{{{ThisMonth}}}","reminders":{}}"""),  // absent statuses must not read as "erase"
            Call($$$"""{"id":1,"cmd":"work_save","site":"x.com","entryId":"{{{_ahmetId}}}","statuses":{},"reminders":{}}"""),
        })
            Assert.Equal("bad_request", (string?)bad["error"]);
        Assert.Empty(Vault.Open(_v.Path, _v.Key).Data.Work);
        Assert.Empty(Vault.Open(_v.Path, _v.Key).Data.Reminders);

        Assert.True((bool)SaveWork(ThisMonth, partial, Due(now.AddMinutes(-4)))["ok"]!); // a slow click is not "in the past"
        Assert.True((bool)SaveWork(ThisMonth, partial, Due(now.AddDays(364)))["ok"]!);
    }

    [Fact]
    public void Work_save_other_site_is_not_found()
    {
        var (t1, _, _) = AddTasks();
        Assert.Equal("not_found", (string?)SaveWork(ThisMonth, $$"""{"{{t1}}":"done"}""", entryId: _ahmetYId)["error"]);
        Assert.Equal("not_found", (string?)SaveWork(ThisMonth, $$"""{"{{t1}}":"done"}""", entryId: "nope")["error"]);
        Assert.Empty(Vault.Open(_v.Path, _v.Key).Data.Work);
    }

    JsonObject Assign(string taskIds, string? entryId = null, string site = "x.com") =>
        Call($$"""{"id":1,"cmd":"work_assign","site":"{{site}}","entryId":"{{entryId ?? _ahmetId}}","taskIds":{{taskIds}}}""");

    [Fact]
    public void Work_assign_stores_the_list_and_work_get_answers_with_it()
    {
        var (t1, t2, old) = AddTasks();
        var due = DateTime.UtcNow.AddHours(2);
        _v.Update(d =>
        {
            d.Work.Add(new WorkRecord { EntryId = _ahmetId, Month = ThisMonth, Tasks = new() { [t1] = "done", [t2] = "partial", [old] = "done" } });
            d.Reminders.Add(new Reminder { EntryId = _ahmetId, TaskId = t2, Month = ThisMonth, DueAt = due });
        });
        // the first choice shows what is already marked this month
        Assert.Equal([(t1, "done"), (t2, "partial")], Call($$"""{"id":3,"cmd":"work_get","site":"x.com","entryId":"{{_ahmetId}}"}""")["statuses"]!.AsObject().Select(p => (p.Key, (string)p.Value!)));

        Assert.Equal("""{"id":1,"ok":true}""", Assign($"""["{t1}"]""").ToJsonString());

        var disk = Vault.Open(_v.Path, _v.Key).Data;
        Assert.Equal([t1], disk.Entries.Single(e => e.Id == _ahmetId).TaskIds);
        Assert.NotNull(Assert.Single(disk.Reminders).ResolvedAt);
        Assert.Equal("partial", Assert.Single(disk.Work).Tasks[t2]); // history stays

        var r = Call($$"""{"id":3,"cmd":"work_get","site":"x.com","entryId":"{{_ahmetId}}"}""");
        Assert.True((bool)r["assigned"]!);
        Assert.Equal([t1], r["tasks"]!.AsArray().Select(t => (string?)t!["id"]));
        Assert.Equal([t1, t2], r["allTasks"]!.AsArray().Select(t => (string?)t!["id"]));
        Assert.Equal([(t1, "done")], r["statuses"]!.AsObject().Select(p => (p.Key, (string)p.Value!))); // an unchosen id sent back would be refused
        Assert.Empty(r["reminders"]!.AsArray());

        Assert.Equal("bad_request", (string?)SaveWork(ThisMonth, $$"""{"{{t2}}":"done"}""")["error"]);
        Assert.True((bool)SaveWork(ThisMonth, $$"""{"{{t1}}":"done"}""")["ok"]!);
        Assert.Equal("partial", Assert.Single(Vault.Open(_v.Path, _v.Key).Data.Work).Tasks[t2]);

        // archiving takes the task off the list's effect: asked again once none is left
        _v.Update(data => Work.ArchiveTask(data, t1, DateTime.UtcNow));
        var empty = Call($$"""{"id":3,"cmd":"work_get","site":"x.com","entryId":"{{_ahmetId}}"}""");
        Assert.False((bool)empty["assigned"]!);
        Assert.Empty(empty["tasks"]!.AsArray());
    }

    [Fact]
    public void Work_assign_validates()
    {
        var (t1, _, old) = AddTasks();
        foreach (var bad in new[]
        {
            Assign("[]"),
            Assign("\"x\""),
            Assign("{}"),
            Assign("5"),
            Assign("null"),
            Assign("[5]"),
            Assign("[null]"),
            Assign($"""["{t1}",5]"""),
            Assign($"""[["{t1}"]]"""),
            Assign("""["nope"]"""),
            Assign($"""["{old}"]"""),
            Assign($"""["{t1}","{t1}"]"""),
            Assign(new JsonArray([.. Enumerable.Range(0, 201).Select(i => (JsonNode?)$"k{i}")]).ToJsonString()),
            Call($$"""{"id":1,"cmd":"work_assign","site":"x.com","entryId":"{{_ahmetId}}"}"""),
            Call($$"""{"id":1,"cmd":"work_assign","site":"x.com","taskIds":["{{t1}}"]}"""),
            Call($$"""{"id":1,"cmd":"work_assign","entryId":"{{_ahmetId}}","taskIds":["{{t1}}"]}"""),
        })
            Assert.Equal("bad_request", (string?)bad["error"]);

        Assert.Equal("not_found", (string?)Assign($"""["{t1}"]""", entryId: _ahmetYId)["error"]); // another site's customer
        Assert.Equal("not_found", (string?)Assign($"""["{t1}"]""", entryId: "nope")["error"]);
        Assert.All(Vault.Open(_v.Path, _v.Key).Entries, e => Assert.Null(e.TaskIds));
    }

    [Fact]
    public void Search_and_summary_follow_the_customers_list()
    {
        var (t1, t2, _) = AddTasks();
        var ali = _v.Entries.Single(e => e.FirstName == "Ali").Id;
        Assign($"""["{t1}","{t2}"]""");
        SaveWork(ThisMonth, $$"""{"{{t1}}":"done"}""");                     // one of two: not finished, the old rule says done
        SaveWork(ThisMonth, $$"""{"{{t1}}":"done"}""", entryId: ali);       // no list: old rule
        string? Of(string id) => (string?)Call("""{"id":1,"cmd":"search","site":"x.com","q":""}""")["items"]!.AsArray().Single(i => (string?)i!["id"] == id)!["monthStatus"];

        Assert.Equal("partial", Of(_ahmetId));
        Assert.Equal("done", Of(ali));
        Assert.Equal($$"""{"id":1,"ok":true,"month":"{{ThisMonth}}","done":1,"partial":1,"notStarted":0}""", Call("""{"id":1,"cmd":"summary"}""").ToJsonString());

        SaveWork(ThisMonth, $$"""{"{{t1}}":"done","{{t2}}":"done"}""");
        Assert.Equal("done", Of(_ahmetId));
    }

    [Fact]
    public void Set_name_only_when_both_names_empty()
    {
        var blank = new Entry { Site = "x.com", Username = "93000000000789123", Password = "p" };
        var half = new Entry { Site = "x.com", LastName = "Elle", Username = "yarim", Password = "p" };
        _v.Update(l => l.AddRange([blank, half]));
        JsonObject Set(string id, string text, string site = "x.com") =>
            Call(new JsonObject { ["id"] = 1, ["cmd"] = "set_name", ["site"] = site, ["entryId"] = id, ["text"] = text }.ToJsonString());
        Entry Disk(string id) => Vault.Open(_v.Path, _v.Key).Entries.Single(e => e.Id == id);

        var unreadable = Set(blank.Id, "Иванов 123"); // no error: the name just stays empty
        Assert.Equal((true, "", "", false), ((bool)unreadable["ok"]!, (string?)unreadable["firstName"], (string?)unreadable["lastName"], (bool)unreadable["changed"]!));

        var set = Set(blank.Id, "Абдылдаева Чолпон Бакытовна");
        Assert.Equal(["changed", "firstName", "id", "lastName", "ok"], set.Select(p => p.Key).Order());
        Assert.Equal(("Чолпон Бакытовна", "Абдылдаева", true), ((string?)set["firstName"], (string?)set["lastName"], (bool)set["changed"]!));
        Assert.Equal(("Чолпон Бакытовна", "Абдылдаева", "p"), (Disk(blank.Id).FirstName, Disk(blank.Id).LastName, Disk(blank.Id).Password));

        var again = Set(blank.Id, "Другой Человек");
        Assert.Equal(("Чолпон Бакытовна", false), ((string?)again["firstName"], (bool)again["changed"]!));

        var stamp = File.ReadAllBytes(_v.Path);
        var typed = Set(half.Id, "Другой Человек"); // one hand-written name is enough to leave the record alone
        Assert.Equal(("", "Elle", false), ((string?)typed["firstName"], (string?)typed["lastName"], (bool)typed["changed"]!));
        Assert.Equal(stamp, File.ReadAllBytes(_v.Path));

        Assert.Equal("not_found", (string?)Set(blank.Id, "Другой Человек", "y.com")["error"]);
        Assert.Equal("bad_request", (string?)Set(half.Id, "Иванов " + new string('я', 94))["error"]); // 101
        Assert.Equal("bad_request", (string?)Call($$"""{"id":1,"cmd":"set_name","site":"x.com","entryId":"{{half.Id}}"}""")["error"]);
    }

    [Fact]
    public void Summary_counts_this_month()
    {
        var (t1, t2, _) = AddTasks();
        var ali = _v.Entries.Single(e => e.FirstName == "Ali").Id;
        var veli = _v.Entries.Single(e => e.FirstName == "Veli").Id;
        _v.Update(d =>
        {
            d.Work.Add(new WorkRecord { EntryId = _ahmetId, Month = ThisMonth, Tasks = new() { [t1] = "done" } });
            d.Work.Add(new WorkRecord { EntryId = ali, Month = ThisMonth, Tasks = new() { [t1] = "done", [t2] = "partial" } });
            d.Work.Add(new WorkRecord { EntryId = veli, Month = LastMonth, Tasks = new() { [t1] = "done" } });
        });
        Assert.Equal($$"""{"id":1,"ok":true,"month":"{{ThisMonth}}","done":1,"partial":1,"notStarted":1}""", Call("""{"id":1,"cmd":"summary"}""").ToJsonString());
    }

    [Fact]
    public void Search_items_carry_this_months_status()
    {
        var (t1, t2, old) = AddTasks();
        var ali = _v.Entries.Single(e => e.FirstName == "Ali").Id;
        var veli = _v.Entries.Single(e => e.FirstName == "Veli").Id;
        _v.Update(d =>
        {
            d.Work.Add(new WorkRecord { EntryId = _ahmetId, Month = ThisMonth, Tasks = new() { [t1] = "done" } });
            d.Work.Add(new WorkRecord { EntryId = ali, Month = ThisMonth, Tasks = new() { [t1] = "done", [t2] = "partial" } });
            d.Work.Add(new WorkRecord { EntryId = veli, Month = LastMonth, Tasks = new() { [t1] = "done" } });
            d.Work.Add(new WorkRecord { EntryId = _ahmetYId, Month = ThisMonth, Tasks = new() { [old] = "partial" } });
        });
        string? Of(string site, string id) => (string?)Call($$"""{"id":1,"cmd":"search","site":"{{site}}","q":""}""")["items"]!.AsArray().Single(i => (string?)i!["id"] == id)!["monthStatus"];

        Assert.Equal("done", Of("x.com", _ahmetId));
        Assert.Equal("partial", Of("x.com", ali));
        Assert.Null(Of("x.com", veli));
        Assert.Null(Of("y.com", _ahmetYId)); // a deleted task does not count, as in the to-do groups

        SaveWork(ThisMonth, $$"""{"{{t1}}":"done"}""", entryId: ali); // the next search sees the write
        Assert.Equal("done", Of("x.com", ali));
    }

    [Fact]
    public void Old_command_set_unchanged()
    {
        Assert.Equal($$"""{"id":1,"ok":true,"locked":false,"count":5,"lang":"{{AppPaths.Lang}}"}""", Call("""{"id":1,"cmd":"status"}""").ToJsonString());
        Assert.Equal("""{"id":2,"ok":true,"username":"ahmet","password":"p1"}""", Call($$"""{"id":2,"cmd":"get","site":"x.com","entryId":"{{_ahmetId}}"}""").ToJsonString());
        Assert.Equal(["entryId", "id", "name", "ok", "result"], Call("""{"id":3,"cmd":"check","site":"x.com","username":"ahmet","password":"p1"}""").Select(p => p.Key).Order());
        Assert.Equal(["extra1", "extra2", "firstName", "id", "lastName", "site", "username"], Call("""{"id":4,"cmd":"all","q":"ahmet"}""")["items"]![0]!.AsObject().Select(p => p.Key).Order());
        Assert.Equal(["extra1", "extra2", "fields", "firstName", "id", "lastName", "ok", "password", "site", "username"], Call($$"""{"id":5,"cmd":"entry","entryId":"{{_ahmetId}}"}""").Select(p => p.Key).Order());
        Assert.Equal("""{"id":6,"ok":false,"error":"bad_request"}""", Call("""{"id":6,"cmd":"work_delete"}""").ToJsonString());
    }

    [Fact]
    public void New_commands_answer_locked_without_a_vault()
    {
        foreach (var cmd in new[] { "work_get", "work_save", "work_assign", "set_name", "summary" })
            Assert.Equal("""{"id":1,"ok":false,"error":"locked"}""", HostApi.Handle(new JsonObject { ["id"] = 1, ["cmd"] = cmd }, () => null).ToJsonString());
    }

    [Fact]
    public void Frame_round_trip()
    {
        var ms = new MemoryStream();
        NativeFrame.Write(ms, new JsonObject { ["id"] = 1, ["ok"] = true, ["q"] = "Şükrü" });
        var bytes = ms.ToArray();
        Assert.Equal(bytes.Length - 4, BitConverter.ToInt32(bytes, 0)); // little-endian prefix
        ms.Position = 0;
        Assert.Equal("""{"id":1,"ok":true,"q":"Şükrü"}""", JsonNode.Parse(NativeFrame.Read(ms)!)!.ToJsonString(new() { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        Assert.Null(NativeFrame.Read(ms)); // EOF
    }
}
