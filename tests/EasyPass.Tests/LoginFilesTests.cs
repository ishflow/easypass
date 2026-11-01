using System.Text.Json.Nodes;
using EasyPass.Core;

namespace EasyPass.Tests;

// Files live in AppPaths.Dir, shared by the whole "settings" collection.
[Collection("settings")]
public class LoginFilesTests
{
    static string LoginFile => Path.Combine(AppPaths.Dir, "login-request.json");
    static string SessionFile => Path.Combine(AppPaths.Dir, "session.json");

    public LoginFilesTests()
    {
        File.Delete(LoginFile);
        File.Delete(SessionFile);
    }

    static string Iso(DateTime utc) => utc.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");

    static void WriteRaw(string entryId, string site, DateTime at) =>
        File.WriteAllText(LoginFile, new JsonObject { ["entryId"] = entryId, ["site"] = site, ["at"] = Iso(at) }.ToJsonString());

    [Theory]
    [InlineData("cabinet.salyk.kg", "https://cabinet.salyk.kg/account/login#easypass-login")]
    [InlineData("https://www.Cabinet.salyk.kg/account/login", "https://cabinet.salyk.kg/account/login#easypass-login")]
    [InlineData("salyk.kg", "https://cabinet.salyk.kg/account/login#easypass-login")] // its entries are offered on the cabinet (Sites.Matches)
    [InlineData("notsalyk.kg", "https://notsalyk.kg/#easypass-login")]
    [InlineData("other.salyk.kg", "https://other.salyk.kg/#easypass-login")]
    [InlineData("https://www.Portal-X.com/a/b?c=1", "https://portal-x.com/#easypass-login")]
    public void Login_url(string site, string expected) => Assert.Equal(expected, Sites.LoginUrl(site));

    [Fact]
    public void Login_request_is_taken_once_on_its_site_or_a_subdomain()
    {
        LoginFiles.WriteLogin("e1", "https://www.X.com/login");
        Assert.Equal("e1", LoginFiles.TakeLogin("portal.x.com"));
        Assert.False(File.Exists(LoginFile));
        Assert.Null(LoginFiles.TakeLogin("x.com"));
    }

    [Fact]
    public void Another_sites_page_gets_nothing_and_does_not_burn_the_request()
    {
        LoginFiles.WriteLogin("e1", "x.com");
        Assert.Null(LoginFiles.TakeLogin("evilx.com"));
        Assert.Null(LoginFiles.TakeLogin("y.com"));
        Assert.Equal("e1", LoginFiles.TakeLogin("x.com"));
    }

    [Fact]
    public void Newest_request_replaces_the_old_one()
    {
        LoginFiles.WriteLogin("e1", "x.com");
        LoginFiles.WriteLogin("e2", "x.com");
        Assert.Equal("e2", LoginFiles.TakeLogin("x.com"));
    }

    [Theory]
    [InlineData(-121)]
    [InlineData(-3600)]
    [InlineData(3600)] // a date in the future must not stay valid for ever
    public void Expired_request_is_gone(int ageSeconds)
    {
        WriteRaw("e1", "x.com", DateTime.UtcNow.AddSeconds(ageSeconds));
        Assert.Null(LoginFiles.TakeLogin("x.com"));
        Assert.False(File.Exists(LoginFile));
    }

    [Fact]
    public void Request_inside_the_window_is_taken()
    {
        WriteRaw("e1", "x.com", DateTime.UtcNow.AddSeconds(-115));
        Assert.Equal("e1", LoginFiles.TakeLogin("x.com"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("bozuk{")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("5")]
    [InlineData("""{"entryId":"e1","site":"x.com"}""")]
    [InlineData("""{"entryId":"e1","site":"x.com","at":"dün"}""")]
    [InlineData("""{"entryId":"e1","site":"x.com","at":5}""")]
    [InlineData("""{"entryId":5,"site":"x.com","at":"2026-11-01T00:00:00.000Z"}""")]
    [InlineData("""{"entryId":"","site":"x.com","at":"2026-11-01T00:00:00.000Z"}""")]
    [InlineData("""{"entryId":"e1","entryId":"e2","site":"x.com","at":"2026-11-01T00:00:00.000Z"}""")]
    public void Corrupt_files_read_as_nothing(string content)
    {
        File.WriteAllText(LoginFile, content);
        File.WriteAllText(SessionFile, content);
        Assert.Null(LoginFiles.TakeLogin("x.com"));
        Assert.Null(LoginFiles.ReadSession());
    }

    [Fact]
    public void A_folder_in_place_of_the_file_reads_as_nothing()
    {
        Directory.CreateDirectory(LoginFile);
        Directory.CreateDirectory(SessionFile);
        try
        {
            Assert.Null(LoginFiles.TakeLogin("x.com"));
            Assert.Null(LoginFiles.ReadSession());
        }
        finally
        {
            Directory.Delete(LoginFile);
            Directory.Delete(SessionFile);
        }
    }

    [Fact]
    public void Session_write_read_clear()
    {
        Assert.Null(LoginFiles.ReadSession());
        var before = DateTime.UtcNow;
        LoginFiles.WriteSession("https://www.X.com/a", "e1");
        var s = LoginFiles.ReadSession()!;
        Assert.Equal(("x.com", "e1", DateTimeKind.Utc), (s.Site, s.EntryId, s.At.Kind));
        Assert.InRange(s.At, before, DateTime.UtcNow);

        LoginFiles.WriteSession("x.com", "e2");
        Assert.Equal("e2", LoginFiles.ReadSession()!.EntryId);

        LoginFiles.ClearSession();
        Assert.False(File.Exists(SessionFile));
        Assert.Null(LoginFiles.ReadSession());
        LoginFiles.ClearSession(); // nothing to clear is fine
    }

    [Fact]
    public void Files_hold_exactly_the_agreed_fields_and_leave_no_temp_behind()
    {
        LoginFiles.WriteLogin("e1", "x.com");
        LoginFiles.WriteSession("x.com", "e1");
        Assert.Equal(["at", "entryId", "site"], JsonNode.Parse(File.ReadAllText(LoginFile))!.AsObject().Select(p => p.Key).Order());
        Assert.Equal(["at", "entryId", "site"], JsonNode.Parse(File.ReadAllText(SessionFile))!.AsObject().Select(p => p.Key).Order());
        Assert.Empty(Directory.GetFiles(AppPaths.Dir, "*.tmp"));
        LoginFiles.TakeLogin("x.com");
        Assert.Empty(Directory.GetFiles(AppPaths.Dir, "login-request.json*"));
    }

    [Fact]
    public void Files_follow_the_app_folder_which_may_not_exist_yet()
    {
        var dir = AppPaths.Dir;
        var temp = Directory.CreateTempSubdirectory("easypass-home-").FullName;
        AppPaths.Dir = Path.Combine(temp, "new");
        try
        {
            Assert.Null(LoginFiles.TakeLogin("x.com"));
            Assert.Null(LoginFiles.ReadSession());
            LoginFiles.ClearSession();
            LoginFiles.WriteLogin("e1", "x.com");
            LoginFiles.WriteSession("x.com", "e1");
            Assert.True(File.Exists(Path.Combine(temp, "new", "login-request.json")));
            Assert.True(File.Exists(Path.Combine(temp, "new", "session.json")));
        }
        finally
        {
            AppPaths.Dir = dir;
            Directory.Delete(temp, true);
        }
    }
}
