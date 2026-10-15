using System.Runtime.CompilerServices;
using EasyPass.Core;

namespace EasyPass.Tests;

static class TestSettings
{
    // Every test sees a throwaway settings folder, never the user's real %APPDATA%\EasyPass.
    [ModuleInitializer]
    internal static void Init()
    {
        AppPaths.Dir = Directory.CreateTempSubdirectory("easypass-settings-").FullName;
        AppDomain.CurrentDomain.ProcessExit += (_, _) => Directory.Delete(AppPaths.Dir, true);
    }
}

// Writes settings.json, so it never runs in parallel with the other "settings" tests that read Lang.
[Collection("settings")]
public class AppPathsTests
{
    readonly string _file = Path.Combine(AppPaths.Dir, "settings.json");

    [Fact]
    public void Dir_is_not_the_real_app_data_folder() =>
        Assert.StartsWith(Path.GetFullPath(Path.GetTempPath()), Path.GetFullPath(AppPaths.Dir));

    [Fact]
    public void Lang_and_VaultPath_are_kept_together()
    {
        AppPaths.VaultPath = "/x/vault.ezp";
        AppPaths.Lang = "tr";
        Assert.Equal(("/x/vault.ezp", "tr"), (AppPaths.VaultPath, AppPaths.Lang));
        AppPaths.VaultPath = "/y/vault.ezp";
        Assert.Equal(("/y/vault.ezp", "tr"), (AppPaths.VaultPath, AppPaths.Lang));
        Assert.False(File.Exists(_file + ".tmp"));
    }

    [Fact]
    public void Lang_defaults_to_ru_when_missing_or_invalid()
    {
        if (File.Exists(_file)) File.Delete(_file);
        Assert.Equal("ru", AppPaths.Lang);
        Directory.CreateDirectory(AppPaths.Dir);
        File.WriteAllText(_file, """{"lang":"de"}""");
        Assert.Equal("ru", AppPaths.Lang);
        File.WriteAllText(_file, "bozuk{");
        Assert.Equal("ru", AppPaths.Lang);
    }
}
