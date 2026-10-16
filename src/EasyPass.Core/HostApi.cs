using System.Text.Json.Nodes;

namespace EasyPass.Core;

// Native Messaging protocol, spec §5. Host Program only does the framing.
// "all" and "entry" reach every site's entries: only the extension's own toolbar popup sends them
// (background.js refuses them from web pages, which only ever see their own site's entries).
public static class HostApi
{
    const int AllLimit = 200; // the popup scrolls through these; typing narrows the search to the rest

    public static JsonObject Handle(JsonObject request, Func<Vault?> getVault)
    {
        var res = new JsonObject { ["id"] = request["id"]?.DeepClone() };
        try
        {
            var cmd = Str(request, "cmd");
            if (cmd is not ("status" or "search" or "get" or "check" or "update" or "add" or "all" or "entry")) return Fail(res, "bad_request");
            if (getVault() is not { } v)
            {
                Fail(res, "locked");
                if (cmd == "status") res["lang"] = AppPaths.Lang; // extension shows the locked message in the app's language
                return res;
            }
            return cmd switch
            {
                "status" => Ok(res, new() { ["locked"] = false, ["count"] = v.Entries.Count, ["lang"] = AppPaths.Lang }),
                "search" => Site(request) is not { } site ? Fail(res, "bad_request") : Ok(res, new()
                {
                    ["items"] = new JsonArray([.. v.Search(Str(request, "q") ?? "", site: site).Select(e => (JsonNode)new JsonObject
                    {
                        ["id"] = e.Id, ["firstName"] = e.FirstName, ["lastName"] = e.LastName,
                        ["extra1"] = e.Extra1, ["extra2"] = e.Extra2, ["username"] = e.Username,
                    })]),
                }),
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
                _ => Add(res, request, v),
            };
        }
        catch (Exception e) { return Fail(res, e.Message); }
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
