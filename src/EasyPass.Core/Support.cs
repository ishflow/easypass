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

    public static string Lang
    {
        get => (string?)Read()["lang"] is "tr" ? "tr" : "ru";
        set => Write("lang", value == "tr" ? "tr" : "ru");
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
