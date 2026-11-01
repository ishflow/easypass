using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace EasyPass.Core;

public static class TextFold
{
    public static string Fold(string s) => string.Create(s.Length, s, static (dst, src) =>
    {
        for (var i = 0; i < src.Length; i++)
            dst[i] = src[i] switch
            {
                'ş' or 'Ş' => 's',
                'ç' or 'Ç' => 'c',
                'ğ' or 'Ğ' => 'g',
                'ı' or 'İ' => 'i',
                'ö' or 'Ö' => 'o',
                'ü' or 'Ü' => 'u',
                'ё' or 'Ё' => 'е',
                var c => char.ToLowerInvariant(c),
            };
    });
}

// Entries are bound to a host; a page may only see entries of its own host or a parent domain (spec §3a).
public static class Sites
{
    public static string Normalize(string input)
    {
        var s = input.Trim();
        if (s.Contains("://")) s = Uri.TryCreate(s, UriKind.Absolute, out var uri) ? uri.Host : "";
        s = s.Split('/')[0].Split(':')[0].ToLowerInvariant();
        return s.StartsWith("www.") ? s[4..] : s;
    }

    public static bool Matches(string entrySite, string pageHost)
    {
        var e = Normalize(entrySite);
        var p = Normalize(pageHost);
        return e.Length > 0 && (p == e || p.EndsWith("." + e, StringComparison.Ordinal));
    }

    const string TaxCabinet = "cabinet.salyk.kg";

    // The #easypass-login mark tells the content script this page was opened by the program's sign-in button (spec §14).
    public static string LoginUrl(string site) => Matches(site, TaxCabinet)
        ? $"https://{TaxCabinet}/account/login#easypass-login"
        : $"https://{Normalize(site)}/#easypass-login";
}

public static class AppPaths
{
    // Tests point it at a temp folder; EASYPASS_HOME overrides it for whole processes (CI smoke runs, development),
    // since the Windows AppData lookup ignores the APPDATA variable.
    public static string Dir { get; internal set; } =
        Environment.GetEnvironmentVariable("EASYPASS_HOME") is { Length: > 0 } home ? home
            : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "EasyPass");

    static string SettingsFile => Path.Combine(Dir, "settings.json");

    public static string? VaultPath
    {
        get => (string?)Read()["vaultPath"];
        set => Write("vaultPath", value);
    }

    // UI languages (Strings.<lang>.xaml, the extension's TEXT tables). Missing or unknown → Russian, the first language.
    public static readonly string[] Languages = ["en", "ru", "tr"];
    public const string DefaultLang = "ru";

    public static string Lang
    {
        get => (string?)Read()["lang"] is { } lang && Languages.Contains(lang) ? lang : DefaultLang;
        set => Write("lang", Languages.Contains(value) ? value : DefaultLang);
    }

    // Where the edge drawer was left; DrawerDock reads it
    public static string? DrawerSpot
    {
        get => (string?)Read()["drawerSpot"];
        set => Write("drawerSpot", value);
    }

    static JsonObject Read()
    {
        try { return JsonNode.Parse(File.ReadAllText(SettingsFile)) as JsonObject ?? []; }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException) { return []; }
    }

    // read-modify-write so setting one field never drops the other
    static void Write(string key, string? value)
    {
        var o = Read();
        o[key] = value;
        Directory.CreateDirectory(Dir);
        // a torn write would read back as {} and drop vaultPath, sending the app to the setup screen
        File.WriteAllText(SettingsFile + ".tmp", o.ToJsonString());
        File.Move(SettingsFile + ".tmp", SettingsFile, overwrite: true);
    }
}

public sealed record SiteSession(string Site, string EntryId, DateTime At);

// The app's "sign in" button and the host share these two files (spec §14). They stay on this computer and never hold a password.
public static class LoginFiles
{
    static readonly TimeSpan LoginLife = TimeSpan.FromSeconds(120);

    static string LoginFile => Path.Combine(AppPaths.Dir, "login-request.json");
    static string SessionFile => Path.Combine(AppPaths.Dir, "session.json");

    public static void WriteLogin(string entryId, string site) => Write(LoginFile, site, entryId);

    // The entry the program asked to sign in on this page's site, once. A page of another site neither gets the request nor uses it up.
    public static string? TakeLogin(string site)
    {
        if (Read(LoginFile) is not { } seen || !Sites.Matches(seen.Site, site)) return null;
        var claimed = $"{LoginFile}.{Guid.NewGuid():N}";
        try
        {
            File.Move(LoginFile, claimed); // only one of two hosts asking together wins the move
            var taken = Read(claimed); // a newer click may have replaced what was seen
            File.Delete(claimed);
            return taken is not null && Sites.Matches(taken.Site, site) && (DateTime.UtcNow - taken.At).Duration() <= LoginLife ? taken.EntryId : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return null; }
    }

    public static void WriteSession(string site, string entryId) => Write(SessionFile, site, entryId);

    public static void ClearSession() { if (File.Exists(SessionFile)) File.Delete(SessionFile); }

    public static SiteSession? ReadSession() => Read(SessionFile);

    static void Write(string file, string site, string entryId)
    {
        Directory.CreateDirectory(AppPaths.Dir);
        var temp = $"{file}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(temp, new JsonObject
        {
            ["site"] = Sites.Normalize(site), ["entryId"] = entryId, ["at"] = DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture),
        }.ToJsonString());
        File.Move(temp, file, overwrite: true);
    }

    static SiteSession? Read(string file)
    {
        // whatever is wrong with the file (missing, torn, hand-edited, duplicate keys) it reads as nothing
        try
        {
            var o = JsonNode.Parse(File.ReadAllText(file))!.AsObject();
            return DateTime.TryParse((string?)o["at"], CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var at)
                && (string?)o["site"] is { Length: > 0 } site && (string?)o["entryId"] is { Length: > 0 } id
                ? new SiteSession(site, id, at) : null;
        }
        catch (Exception) { return null; }
    }
}

public static class KeyCache
{
    static string FilePath => Path.Combine(AppPaths.Dir, "key.bin");

    public static void Save(byte[] salt, byte[] key)
    {
        if (!OperatingSystem.IsWindows()) return;
        Directory.CreateDirectory(AppPaths.Dir);
        File.WriteAllBytes(FilePath, ProtectedData.Protect([.. salt, .. key], null, DataProtectionScope.CurrentUser));
    }

    public static byte[]? Load(byte[] salt)
    {
        if (!OperatingSystem.IsWindows() || !File.Exists(FilePath)) return null;
        try
        {
            var data = ProtectedData.Unprotect(File.ReadAllBytes(FilePath), null, DataProtectionScope.CurrentUser);
            return data.Length == salt.Length + 32 && data.AsSpan(0, salt.Length).SequenceEqual(salt) ? data[salt.Length..] : null;
        }
        catch (Exception e) when (e is CryptographicException or IOException) { return null; }
    }

    public static void Clear() { if (File.Exists(FilePath)) File.Delete(FilePath); }
}
