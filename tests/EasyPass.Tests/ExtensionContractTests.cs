using System.Text.Json;
using System.Text.Json.Nodes;
using EasyPass.Core;

namespace EasyPass.Tests;

// The exact messages extension/background.js posts (content.js message + site + numeric id, see ask() and handle()),
// fed to the real HostApi; asserts every field content.js / popup.js / background.js reads, with fake-host.mjs's data.
[Collection("settings")]
public class ExtensionContractTests : IDisposable
{
    const string X = "portal-x.test", Y = "portal-y.test";
    readonly TempDir _tmp = new();
    readonly Vault _v;
    readonly string _ahmetX;
    public void Dispose() => _tmp.Dispose();

    public ExtensionContractTests()
    {
        _v = Vault.Create(_tmp.File(), "pw");
        var ahmetX = new Entry { Site = X, FirstName = "Ahmet", LastName = "Yılmaz", Username = "ahmet.yilmaz", Password = "eski123", Extra1 = "Kadıköy şube" };
        _ahmetX = ahmetX.Id;
        _v.Update(l => l.AddRange([
            ahmetX,
            new Entry { Site = X, FirstName = "Ahmet", LastName = "Kaya", Username = "akaya", Password = "kaya999" },
            new Entry { Site = X, FirstName = "Mehmet", LastName = "Ahmetoğlu", Username = "mehmet.a", Password = "mm111" },
            new Entry { Site = X, FirstName = "Şükrü", LastName = "Öztürk", Username = "sukru", Password = "sk222", Extra2 = "VIP" },
            new Entry { Site = X, FirstName = "Ayşe", LastName = "Demir", Username = "ayse.demir", Password = "ad333" },
            new Entry { Site = Y, FirstName = "Ahmet", LastName = "Yılmaz", Username = "ahmet.yilmaz", Password = "lh-pass" },
            new Entry { Site = Y, FirstName = "Lale", LastName = "Host", Username = "lale", Password = "ll444" },
        ]));
    }

    int _seq;

    // background.js: port.postMessage({ ...msg, id: ++seq }); the reply is routed by waiting.get(r.id)
    JsonObject Ask(object msg, Func<Vault?>? vault = null)
    {
        var req = JsonSerializer.SerializeToNode(msg)!.AsObject();
        req["id"] = ++_seq;
        var r = JsonNode.Parse(HostApi.Handle(req, vault ?? (() => _v)).ToJsonString())!.AsObject(); // as Chrome sees it
        Assert.Equal(JsonValueKind.Number, r["id"]!.GetValueKind());
        Assert.Equal(_seq, (int)r["id"]!);
        Assert.True(r["ok"]!.GetValueKind() is JsonValueKind.True or JsonValueKind.False);
        return r;
    }

    static string[] Keys(JsonObject o) => [.. o.Select(p => p.Key).Order()];

    [Fact]
    public void Status_for_popup_and_language()
    {
        // popup.js → handle() default branch adds site; background 'lang' asks without site
        foreach (var r in new[] { Ask(new { cmd = "status", site = "ext-id" }), Ask(new { cmd = "status" }) })
        {
            Assert.True((bool)r["ok"]!);
            Assert.False((bool)r["locked"]!);
            Assert.Equal(7, (int)r["count"]!);
            Assert.Contains((string?)r["lang"], new[] { "ru", "tr" });
        }
    }

    [Fact]
    public void Locked_replies()
    {
        var status = Ask(new { cmd = "status" }, () => null);
        Assert.Equal(("locked", false), ((string?)status["error"], (bool)status["ok"]!)); // popup: r.error === 'locked'
        Assert.Contains((string?)status["lang"], new[] { "ru", "tr" }); // background keeps r.lang even when locked
        Assert.Equal("locked", (string?)Ask(new { cmd = "search", q = "a", site = X }, () => null)["error"]); // content: message(r.error)
    }

    [Fact]
    public void Search_items_have_exactly_the_fields_the_panel_reads()
    {
        var items = Ask(new { cmd = "search", q = "ahm", site = X })["items"]!.AsArray();
        Assert.Equal(["Ahmet Kaya", "Ahmet Yılmaz", "Mehmet Ahmetoğlu"], items.Select(i => $"{i!["firstName"]} {i["lastName"]}"));
        foreach (var i in items)
            Assert.Equal(["extra1", "extra2", "firstName", "id", "lastName", "username"], Keys(i!.AsObject())); // no password, no site
        var a = items[1]!;
        Assert.Equal((_ahmetX, "ahmet.yilmaz", "Kadıköy şube", ""), ((string?)a["id"], (string?)a["username"], (string?)a["extra1"], (string?)a["extra2"]));
    }

    [Fact]
    public void Popup_lists_every_site_and_opens_one_entry()
    {
        // popup.js → { cmd: 'all', q } and { cmd: 'entry', entryId }; background adds the extension's own host as site
        var items = Ask(new { cmd = "all", q = "", site = "ext-id" })["items"]!.AsArray();
        Assert.Equal(7, items.Count);
        foreach (var i in items)
            Assert.Equal(["extra1", "extra2", "firstName", "id", "lastName", "site", "username"], Keys(i!.AsObject())); // no password
        Assert.Equal(2, Ask(new { cmd = "all", q = "portal-y", site = "ext-id" })["items"]!.AsArray().Count);
        var e = Ask(new { cmd = "entry", entryId = _ahmetX, site = "ext-id" });
        Assert.Equal(["extra1", "extra2", "fields", "firstName", "id", "lastName", "ok", "password", "site", "username"], Keys(e));
        Assert.Equal((X, "ahmet.yilmaz", "eski123", "Kadıköy şube"), ((string?)e["site"], (string?)e["username"], (string?)e["password"], (string?)e["extra1"]));
    }

    [Fact]
    public void Search_does_not_match_the_page_host_itself()
    {
        // spec §5: only "ad soyad kullanıcıadı ek1 ek2"; every entry on the page shares the site text
        Assert.Empty(Ask(new { cmd = "search", q = "portal", site = X })["items"]!.AsArray());
        Assert.Equal(5, Ask(new { cmd = "search", q = "", site = X })["items"]!.AsArray().Count);
        Assert.Equal(["lale"], Ask(new { cmd = "search", q = "lale", site = "www." + Y })["items"]!.AsArray().Select(i => (string?)i!["username"]));
    }

    [Fact]
    public void Fill_save_and_update_flow()
    {
        // fill: content get → username/password
        var got = Ask(new { cmd = "get", site = X, entryId = _ahmetX });
        Assert.Equal(("ahmet.yilmaz", "eski123"), ((string?)got["username"], (string?)got["password"]));
        Assert.Equal("not_found", (string?)Ask(new { cmd = "get", site = Y, entryId = _ahmetX })["error"]);

        // submit of the filled login with a new password: background adds entryId from lastFilled
        var check = Ask(new { cmd = "check", site = X, username = "ahmet.yilmaz", password = "yeni456", entryId = _ahmetX });
        Assert.Equal(("changed", _ahmetX, "Ahmet Yılmaz"), ((string?)check["result"], (string?)check["entryId"], (string?)check["name"]));
        // toast "update": content sends { cmd, entryId, password }, background adds site
        Assert.Equal(["id", "ok"], Keys(Ask(new { cmd = "update", entryId = _ahmetX, password = "yeni456", site = X })));
        Assert.Equal("same", (string?)Ask(new { cmd = "check", site = X, username = "AHMET.YILMAZ", password = "yeni456" })["result"]);
        Assert.Equal("lh-pass", (string?)Ask(new { cmd = "get", site = Y, entryId = Ask(new { cmd = "search", q = "ahmet", site = Y })["items"]![0]!["id"]!.ToString() })["password"]);

        // unknown login → "new", no entryId/name; toast "add"
        var fresh = Ask(new { cmd = "check", site = X, username = "zeynep", password = "z1" });
        Assert.Equal(["id", "ok", "result"], Keys(fresh));
        Assert.Equal("new", (string?)fresh["result"]);
        // background: the captured form minus the login itself, as { label, value, secret }
        var added = Ask(new
        {
            cmd = "add", firstName = "Zeynep", lastName = "", username = "zeynep", password = "z1", site = X,
            fields = new object[] { new { label = "Ad Soyad", value = "Zeynep Arslan", secret = false }, new { label = "TC kimlik no", value = "123", secret = true } },
        });
        var id = (string?)added["entryId"];
        var saved = Ask(new { cmd = "entry", entryId = id, site = "ext-id" })["fields"]!.AsArray(); // popup.js reads label, value, secret
        Assert.Equal([("Ad Soyad", "Zeynep Arslan", false), ("TC kimlik no", "123", true)],
            saved.Select(f => ((string?)f!["label"], (string?)f["value"], (bool)f["secret"]!)));
        Assert.False(string.IsNullOrEmpty(id));
        Assert.Equal(id, (string?)Assert.Single(Ask(new { cmd = "search", q = "zeyn", site = X })["items"]!.AsArray())!["id"]);
        Assert.Equal(("same", "Zeynep"), ((string?)Ask(new { cmd = "check", site = X, username = "zeynep", password = "z1" })["result"],
            (string?)Ask(new { cmd = "check", site = X, username = "zeynep", password = "z2" })["name"]));
    }
}
