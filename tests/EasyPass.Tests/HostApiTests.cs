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
