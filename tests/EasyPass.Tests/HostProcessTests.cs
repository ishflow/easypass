using System.Diagnostics;
using System.Text.Json.Nodes;
using EasyPass.Core;
using EasyPass.Host;

namespace EasyPass.Tests;

// The real EasyPass.Host executable, run the way Chrome runs it: own process, settings from EASYPASS_HOME,
// key from the DPAPI cache. Only Windows has the cache; elsewhere the host can only answer "locked".
// CI sets EASYPASS_SMOKE_HOME to keep the folder (vault + key cache) for the app's start-up smoke run.
[Collection("settings")]
public class HostProcessTests
{
    [Fact]
    public void Real_host_process_answers_status_add_search_get_per_site()
    {
        var keep = Environment.GetEnvironmentVariable("EASYPASS_SMOKE_HOME");
        var home = keep is { Length: > 0 } ? Directory.CreateDirectory(keep).FullName
            : Directory.CreateTempSubdirectory("easypass-home-").FullName;
        var vault = Vault.Create(Path.Combine(home, "vault.ezp"), "smoke-password-1");
        var dir = AppPaths.Dir;
        AppPaths.Dir = home; // safe: every test that touches settings is in the "settings" collection
        try
        {
            AppPaths.VaultPath = vault.Path;
            KeyCache.Save(vault.Salt, vault.Key);
        }
        finally { AppPaths.Dir = dir; }

        var start = new ProcessStartInfo(Path.Combine(AppContext.BaseDirectory, OperatingSystem.IsWindows() ? "EasyPass.Host.exe" : "EasyPass.Host"))
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            UseShellExecute = false,
        };
        start.Environment["EASYPASS_HOME"] = home;
        using var host = Process.Start(start)!;
        try
        {
            var id = 0;
            JsonObject Ask(JsonObject request)
            {
                request["id"] = ++id;
                NativeFrame.Write(host.StandardInput.BaseStream, request);
                var reply = JsonNode.Parse(NativeFrame.Read(host.StandardOutput.BaseStream)!)!.AsObject();
                Assert.Equal(id, (int)reply["id"]!);
                return reply;
            }

            if (!OperatingSystem.IsWindows())
            {
                Assert.Equal("""{"id":1,"ok":false,"error":"locked","lang":"ru"}""", Ask(new() { ["cmd"] = "status" }).ToJsonString());
                return;
            }
            Assert.Equal("""{"id":1,"ok":true,"locked":false,"count":0,"lang":"ru"}""", Ask(new() { ["cmd"] = "status" }).ToJsonString());

            JsonObject Add(string site, string password) => Ask(new()
            {
                ["cmd"] = "add", ["site"] = site, ["firstName"] = "Ахмет", ["lastName"] = "Yılmaz", ["username"] = "ahmet", ["password"] = password,
            });
            var x = (string)Add("portal.x.com", "x-pass")["entryId"]!;
            var y = (string)Add("portal.y.com", "y-pass")["entryId"]!;
            Assert.Equal(2, (int)Ask(new() { ["cmd"] = "status" })["count"]!);

            JsonArray Search(string site, string q) => Ask(new() { ["cmd"] = "search", ["site"] = site, ["q"] = q })["items"]!.AsArray();
            var hit = Assert.Single(Search("portal.x.com", "ахм"));
            Assert.Equal(x, (string)hit!["id"]!);
            Assert.Null(hit["password"]);
            Assert.Equal(y, (string)Assert.Single(Search("app.portal.y.com", ""))!["id"]!);

            JsonObject Get(string site, string entryId) => Ask(new() { ["cmd"] = "get", ["site"] = site, ["entryId"] = entryId });
            Assert.Equal("x-pass", (string)Get("portal.x.com", x)["password"]!);
            Assert.Equal("not_found", (string)Get("portal.y.com", x)["error"]!); // never another site's password
        }
        finally
        {
            host.StandardInput.Close(); // Chrome disconnecting: the host exits on end of stdin
            var exited = host.WaitForExit(5000);
            if (!exited) host.Kill();
            if (keep is not { Length: > 0 }) Directory.Delete(home, true);
            Assert.True(exited, "host exits when stdin closes");
        }
    }
}
