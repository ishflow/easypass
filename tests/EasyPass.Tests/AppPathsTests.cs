using EasyPass.Core;

namespace EasyPass.Tests;

// Touches the real settings.json, so it is restored afterwards and never runs in parallel with HostApiTests.
[Collection("settings")]
public class AppPathsTests : IDisposable
{
    readonly string _file = Path.Combine(AppPaths.Dir, "settings.json");
    readonly string? _backup;
    readonly bool _dirExisted = Directory.Exists(AppPaths.Dir);

    public AppPathsTests() => _backup = File.Exists(_file) ? File.ReadAllText(_file) : null;

    public void Dispose()
    {
        if (_backup is not null) File.WriteAllText(_file, _backup);
        else if (!_dirExisted) Directory.Delete(AppPaths.Dir, true);
        else if (File.Exists(_file)) File.Delete(_file);
    }

    [Fact]
    public void Lang_and_VaultPath_are_kept_together()
    {
        AppPaths.VaultPath = "/x/vault.ezp";
        AppPaths.Lang = "tr";
        Assert.Equal(("/x/vault.ezp", "tr"), (AppPaths.VaultPath, AppPaths.Lang));
        AppPaths.VaultPath = "/y/vault.ezp";
        Assert.Equal(("/y/vault.ezp", "tr"), (AppPaths.VaultPath, AppPaths.Lang));
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
