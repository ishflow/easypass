using System.Globalization;
using System.Text.Json.Nodes;

namespace EasyPass.Core;

// Native Messaging protocol, spec §5. Host Program only does the framing.
// "all" and "entry" reach every site's entries: only the extension's own toolbar popup sends them
// (background.js refuses them from web pages, which only ever see their own site's entries).
// "summary" is popup-only too; "work_*" and "set_name" come only from a tracked site, with the sender's real site.
// "login_take" and "session_state" are sent by background.js itself, never on a web page's behalf (spec §14).
public static class HostApi
{
    const int AllLimit = 200; // the popup scrolls through these; typing narrows the search to the rest
    const int MaxWorkKeys = 200, MaxNameText = 100;
    const string IsoUtc = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'"; // what Date.prototype.toISOString() writes
    static readonly TimeSpan DueSlack = TimeSpan.FromMinutes(5), DueHorizon = TimeSpan.FromDays(365);

    public static JsonObject Handle(JsonObject request, Func<Vault?> getVault)
    {
        var res = new JsonObject { ["id"] = request["id"]?.DeepClone() };
        try
        {
            var cmd = Str(request, "cmd");
            if (cmd is not ("status" or "search" or "get" or "check" or "update" or "add" or "all" or "entry"
                or "work_get" or "work_save" or "work_assign" or "set_name" or "summary" or "login_take" or "session_state")) return Fail(res, "bad_request");
            if (getVault() is not { } v)
            {
                Fail(res, "locked");
                if (cmd == "status") res["lang"] = AppPaths.Lang; // extension shows the locked message in the app's language
                return res;
            }
            return cmd switch
            {
                "status" => Ok(res, new() { ["locked"] = false, ["count"] = v.Entries.Count, ["lang"] = AppPaths.Lang }),
                "search" => Site(request) is not { } site ? Fail(res, "bad_request") : Search(res, request, v, site),
                "get" => Site(request) is not { } site || Str(request, "entryId") is not { } id ? Fail(res, "bad_request")
                    : Find(v, id, site) is not { } e ? Fail(res, "not_found")
                    : Ok(res, new() { ["username"] = e.Username, ["password"] = e.Password }),
                "check" => Check(res, request, v),
                "update" => Update(res, request, v),
                "all" => Ok(res, new()
                {
                    ["items"] = new JsonArray([.. v.Search(Str(request, "q") ?? "", AllLimit).Select(e => (JsonNode)new JsonObject
                    {
                        ["id"] = e.Id, ["site"] = e.Site, ["firstName"] = e.FirstName, ["lastName"] = e.LastName,
                        ["extra1"] = e.Extra1, ["extra2"] = e.Extra2, ["username"] = e.Username,
                    })]),
                }),
                "entry" => Str(request, "entryId") is not { } entryId ? Fail(res, "bad_request")
                    : v.Entries.FirstOrDefault(e => e.Id == entryId) is not { } en ? Fail(res, "not_found")
                    : Ok(res, new()
                    {
                        ["site"] = en.Site, ["firstName"] = en.FirstName, ["lastName"] = en.LastName, ["extra1"] = en.Extra1,
                        ["extra2"] = en.Extra2, ["username"] = en.Username, ["password"] = en.Password,
                        ["fields"] = new JsonArray([.. en.Fields.Select(f => (JsonNode)new JsonObject
                        {
                            ["label"] = f.Label, ["value"] = f.Value, ["secret"] = f.Secret,
                        })]),
                    }),
                "work_get" => WorkGet(res, request, v),
                "work_save" => WorkSave(res, request, v),
                "work_assign" => WorkAssign(res, request, v),
                "set_name" => SetName(res, request, v),
                "summary" => Summary(res, v),
                "login_take" => Site(request) is not { } takeSite ? Fail(res, "bad_request")
                    : Ok(res, new() { ["entryId"] = LoginFiles.TakeLogin(takeSite) is { } taken ? Find(v, taken, takeSite)?.Id : null }),
                "session_state" => SessionState(res, request, v),
                _ => Add(res, request, v),
            };
        }
        catch (Exception e) { return Fail(res, e.Message); }
    }

    static JsonObject Search(JsonObject res, JsonObject req, Vault v, string site)
    {
        var month = Work.MonthOf(DateTime.Now);
        var active = Work.ActiveTasks(v.Data);
        var thisMonth = v.Data.WorkIn(month);
        return Ok(res, new()
        {
            ["items"] = new JsonArray([.. v.Search(Str(req, "q") ?? "", site: site).Select(e => (JsonNode)new JsonObject
            {
                ["id"] = e.Id, ["firstName"] = e.FirstName, ["lastName"] = e.LastName,
                ["extra1"] = e.Extra1, ["extra2"] = e.Extra2, ["username"] = e.Username,
                ["monthStatus"] = Work.MonthStatus(thisMonth, e, month, active),
            })]),
        });
    }

    static JsonObject WorkGet(JsonObject res, JsonObject req, Vault v)
    {
        if (Site(req) is not { } site || Str(req, "entryId") is not { } id) return Fail(res, "bad_request");
        var month = Work.MonthOf(DateTime.Now);
        if (req["month"] is not null && (Str(req, "month") is not { } asked || !Work.IsMonth(month = asked))) return Fail(res, "bad_request");
        if (Find(v, id, site) is not { } e) return Fail(res, "not_found");
        var active = Work.ActiveTasks(v.Data);
        var own = Work.OwnTasks(e, active);
        var chosen = Work.TasksOf(v.Data, e);
        var statuses = new JsonObject();
        if (v.Data.Work.FirstOrDefault(w => w.EntryId == id && w.Month == month) is { } record)
            foreach (var (task, status) in record.Tasks)
                if (own.Contains(task)) statuses[task] = status; // an archived or unchosen id sent back would be refused
        return Ok(res, new()
        {
            ["username"] = e.Username, ["name"] = e.FullName, ["month"] = month,
            ["assigned"] = chosen.Count > 0,
            ["tasks"] = TaskList(chosen),
            ["allTasks"] = TaskList(v.Data.Tasks.Where(t => !t.Archived)),
            ["statuses"] = statuses,
            ["reminders"] = new JsonArray([.. v.Data.Reminders.Where(r => r.EntryId == id && r.Month == month && r.ResolvedAt is null).Select(r => (JsonNode)new JsonObject
            {
                ["taskId"] = r.TaskId, ["dueAt"] = r.DueAt.ToString(IsoUtc, CultureInfo.InvariantCulture), ["dismissed"] = r.DismissedAt is not null,
            })]),
        });
    }

    static JsonArray TaskList(IEnumerable<WorkTask> tasks) =>
        new([.. tasks.Select(t => (JsonNode)new JsonObject { ["id"] = t.Id, ["name"] = t.Name })]);

    static JsonObject WorkAssign(JsonObject res, JsonObject req, Vault v)
    {
        if (Site(req) is not { } site || Str(req, "entryId") is not { } id || req["taskIds"] is not JsonArray raw || raw.Count > MaxWorkKeys)
            return Fail(res, "bad_request");
        var ids = new List<string>();
        foreach (var item in raw)
        {
            if (item is not JsonValue j || !j.TryGetValue(out string? task) || task is null) return Fail(res, "bad_request");
            ids.Add(task);
        }
        if (Find(v, id, site) is null) return Fail(res, "not_found");
        var found = false;
        v.Update(d =>
        {
            if (!d.Entries.Any(e => e.Id == id && Sites.Matches(e.Site, site))) return;
            Work.Assign(d, id, ids, DateTime.UtcNow); // refuses unknown and archived tasks, duplicates, an empty list
            found = true;
        });
        return found ? Ok(res, new()) : Fail(res, "not_found");
    }

    static JsonObject WorkSave(JsonObject res, JsonObject req, Vault v)
    {
        if (Site(req) is not { } site || Str(req, "entryId") is not { } id || Str(req, "month") is not { } month
            || req["statuses"] is not JsonObject rawStatuses || req["reminders"] is not JsonObject rawReminders
            || rawStatuses.Count > MaxWorkKeys || rawReminders.Count > MaxWorkKeys)
            return Fail(res, "bad_request");
        // the month the login happened in: the session may have started before midnight on the last day
        var local = DateTime.Now;
        if (month != Work.MonthOf(local) && month != Work.MonthOf(local.AddMonths(-1))) return Fail(res, "bad_request");

        var statuses = new Dictionary<string, string>();
        foreach (var (task, _) in rawStatuses)
        {
            if (Str(rawStatuses, task) is not { } status) return Fail(res, "bad_request");
            statuses[task] = status;
        }
        var now = DateTime.UtcNow;
        var reminders = new Dictionary<string, DateTime>();
        foreach (var (task, _) in rawReminders)
        {
            if (Str(rawReminders, task) is not { } text
                || !DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var due)
                || due < now - DueSlack || due > now + DueHorizon)
                return Fail(res, "bad_request");
            reminders[task] = due;
        }

        if (Find(v, id, site) is null) return Fail(res, "not_found");
        var found = false;
        v.Update(d =>
        {
            if (!d.Entries.Any(e => e.Id == id && Sites.Matches(e.Site, site))) return;
            Work.Save(d, id, month, statuses, reminders, now); // refuses unknown, archived and unchosen tasks, bad statuses
            found = true;
        });
        return found ? Ok(res, new()) : Fail(res, "not_found");
    }

    static JsonObject SetName(JsonObject res, JsonObject req, Vault v)
    {
        if (Site(req) is not { } site || Str(req, "entryId") is not { } id || Str(req, "text") is not { Length: <= MaxNameText } text)
            return Fail(res, "bad_request");
        if (Find(v, id, site) is not { } before) return Fail(res, "not_found");
        var changed = false;
        if (NoName(before) && Work.ParseName(text) is { } name)
            v.Update(list =>
            {
                if (list.FirstOrDefault(e => e.Id == id && Sites.Matches(e.Site, site)) is not { } e || !NoName(e)) return;
                (e.LastName, e.FirstName, e.UpdatedAt) = (name.LastName, name.FirstName, DateTime.UtcNow);
                changed = true;
            });
        return Find(v, id, site) is not { } after ? Fail(res, "not_found")
            : Ok(res, new() { ["firstName"] = after.FirstName, ["lastName"] = after.LastName, ["changed"] = changed });
    }

    // a name typed by hand always wins over one read from the site
    static bool NoName(Entry e) => string.IsNullOrWhiteSpace(e.FirstName) && string.IsNullOrWhiteSpace(e.LastName);

    static JsonObject SessionState(JsonObject res, JsonObject req, Vault v)
    {
        // an absent entryId must not read as "logged out"
        if (Site(req) is not { } site || !req.ContainsKey("entryId")) return Fail(res, "bad_request");
        if (req["entryId"] is null)
        {
            if (LoginFiles.ReadSession() is { } open && Sites.Matches(open.Site, site)) LoginFiles.ClearSession();
            return Ok(res, new());
        }
        if (Str(req, "entryId") is not { } id) return Fail(res, "bad_request");
        if (Find(v, id, site) is null) return Fail(res, "not_found");
        LoginFiles.WriteSession(site, id);
        return Ok(res, new());
    }

    static JsonObject Summary(JsonObject res, Vault v)
    {
        var month = Work.MonthOf(DateTime.Now);
        var todo = Work.Todo(v.Data, month);
        return Ok(res, new() { ["month"] = month, ["done"] = todo.Done, ["partial"] = todo.Unfinished, ["notStarted"] = todo.NotStarted });
    }

    static JsonObject Check(JsonObject res, JsonObject req, Vault v)
    {
        if (Site(req) is not { } site || Str(req, "username") is not { } user || Str(req, "password") is not { } pass)
            return Fail(res, "bad_request");
        if (Str(req, "entryId") is { } id && Find(v, id, site) is { } byId) return Result(res, byId, pass);
        var matches = v.Entries.Where(e => Sites.Matches(e.Site, site) && string.Equals(e.Username, user, StringComparison.OrdinalIgnoreCase)).ToList();
        return matches.Count switch
        {
            0 => Ok(res, new() { ["result"] = "new" }),
            1 => Result(res, matches[0], pass),
            _ => matches.FirstOrDefault(e => e.Password == pass) is { } same ? Result(res, same, pass)
                : Ok(res, new() { ["result"] = "ambiguous" }),
        };
    }

    static JsonObject Result(JsonObject res, Entry e, string pass) => Ok(res, new()
    {
        ["result"] = e.Password == pass ? "same" : "changed", ["entryId"] = e.Id, ["name"] = e.FullName,
    });

    static JsonObject Update(JsonObject res, JsonObject req, Vault v)
    {
        if (Site(req) is not { } site || Str(req, "entryId") is not { } id || Str(req, "password") is not { } pass)
            return Fail(res, "bad_request");
        if (Find(v, id, site) is null) return Fail(res, "not_found");
        var found = false;
        v.Update(list =>
        {
            if (list.FirstOrDefault(e => e.Id == id && Sites.Matches(e.Site, site)) is not { } e) return;
            e.Password = pass;
            e.UpdatedAt = DateTime.UtcNow;
            found = true;
        });
        return found ? Ok(res, new()) : Fail(res, "not_found");
    }

    static JsonObject Add(JsonObject res, JsonObject req, Vault v)
    {
        if (Site(req) is not { } site || Str(req, "username") is not { } user || Str(req, "password") is not { } pass)
            return Fail(res, "bad_request");
        var e = new Entry
        {
            Site = Sites.Normalize(site), FirstName = Str(req, "firstName") ?? "", LastName = Str(req, "lastName") ?? "",
            Username = user, Password = pass, Fields = Fields(req),
        };
        v.Update(list => list.Add(e));
        return Ok(res, new() { ["entryId"] = e.Id });
    }

    const int MaxFields = 30, MaxLabel = 100, MaxValue = 1000;

    // The sign-up form's other fields; anything malformed is dropped, sizes are capped (they come from a web page's DOM).
    static List<EntryField> Fields(JsonObject req) => req["fields"] is not JsonArray items ? [] : [..
        items.OfType<JsonObject>()
            .Select(f => (label: Str(f, "label")?.Trim() ?? "", value: Str(f, "value")?.Trim() ?? "",
                secret: f["secret"] is JsonValue s && s.TryGetValue(out bool b) && b))
            .Where(f => f.value != "")
            .Take(MaxFields)
            .Select(f => new EntryField { Label = Cap(f.label, MaxLabel), Value = Cap(f.value, MaxValue), Secret = f.secret })];

    static string Cap(string s, int max) => s.Length <= max ? s : s[..max];

    // another site's entry is reported as not_found: its password must never leave the vault for this page
    static Entry? Find(Vault v, string id, string site) => v.Entries.FirstOrDefault(e => e.Id == id && Sites.Matches(e.Site, site));

    static string? Site(JsonObject o) => Str(o, "site") is { } s && Sites.Normalize(s).Length > 0 ? s : null;

    // non-string values count as missing
    static string? Str(JsonObject o, string key) => o[key] is JsonValue j && j.TryGetValue(out string? s) ? s : null;

    static JsonObject Ok(JsonObject res, JsonObject fields)
    {
        res["ok"] = true;
        foreach (var (k, val) in fields.ToList()) { fields.Remove(k); res[k] = val; }
        return res;
    }

    static JsonObject Fail(JsonObject res, string error)
    {
        res["ok"] = false;
        res["error"] = error;
        return res;
    }
}
