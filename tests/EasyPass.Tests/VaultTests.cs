using System.Diagnostics;
using System.Security.Cryptography;
using EasyPass.Core;

namespace EasyPass.Tests;

public sealed class TempDir : IDisposable
{
    public string Dir { get; } = Directory.CreateTempSubdirectory("easypass-test-").FullName;
    public string File(string name = "vault.ezp") => System.IO.Path.Combine(Dir, name);
    public void Dispose() => Directory.Delete(Dir, true);
}

public class VaultTests : IDisposable
{
    readonly TempDir _tmp = new();
    public void Dispose() => _tmp.Dispose();

    [Fact]
    public void Create_then_open_round_trips_entries()
    {
        var path = _tmp.File();
        var v = Vault.Create(path, "ana-şifre");
        v.Update(l => l.Add(new Entry { FirstName = "Ahmet", LastName = "Yılmaz", Username = "ahmet", Password = "p1", Extra1 = "x" }));

        var w = Vault.Open(path, "ana-şifre");
        var e = Assert.Single(w.Entries);
        Assert.Equal(("Ahmet", "Yılmaz", "ahmet", "p1", "x"), (e.FirstName, e.LastName, e.Username, e.Password, e.Extra1));
        Assert.Equal(v.Salt, w.Salt);
        Assert.Equal(v.Key, w.Key);
        Assert.Equal(v.Salt, Vault.ReadSalt(path));
        Assert.Equal(v.Entries[0].Id, Vault.Open(path, v.Key).Entries[0].Id);
    }

    [Fact]
    public void File_has_spec_header_and_no_plaintext()
    {
        var path = _tmp.File();
        Vault.Create(path, "pw").Update(l => l.Add(new Entry { Username = "gizli-kullanici" }));
        var bytes = File.ReadAllBytes(path);
        Assert.Equal("EZP1"u8.ToArray(), bytes[..4]);
        Assert.Equal(600_000, BitConverter.ToInt32(bytes, 4));
        Assert.DoesNotContain("gizli", System.Text.Encoding.UTF8.GetString(bytes));
    }

    [Fact]
    public void Create_fails_when_file_exists()
    {
        var path = _tmp.File();
        Vault.Create(path, "pw");
        Assert.Throws<IOException>(() => Vault.Create(path, "pw"));
    }

    [Fact]
    public void Wrong_password_throws_CryptographicException()
    {
        var path = _tmp.File();
        Vault.Create(path, "dogru");
        Assert.ThrowsAny<CryptographicException>(() => Vault.Open(path, "yanlis"));
    }

    [Fact]
    public void Tampered_tag_throws()
    {
        var path = _tmp.File();
        var key = Vault.Create(path, "pw").Key;
        var bytes = File.ReadAllBytes(path);
        bytes[4 + 4 + 16 + 12] ^= 1; // first tag byte
        File.WriteAllBytes(path, bytes);
        Assert.ThrowsAny<CryptographicException>(() => Vault.Open(path, key));
    }

    [Fact]
    public void Update_persists_and_keeps_previous_version_as_bak()
    {
        var path = _tmp.File();
        var v = Vault.Create(path, "pw");
        v.Update(l => l.Add(new Entry { Username = "a" }));
        v.Update(l => l.Add(new Entry { Username = "b" }));

        Assert.Equal(["a", "b"], Vault.Open(path, v.Key).Entries.Select(e => e.Username));
        Assert.Equal(["a"], Vault.Open(path + ".bak", v.Key).Entries.Select(e => e.Username));
        Assert.False(File.Exists(path + ".tmp"));
    }

    [Fact]
    public void ReloadIfChanged_sees_write_from_other_instance()
    {
        var path = _tmp.File();
        var a = Vault.Create(path, "pw");
        var b = Vault.Open(path, a.Key);

        Assert.False(a.ReloadIfChanged());
        b.Update(l => l.Add(new Entry { Username = "from-b" }));
        Assert.True(a.ReloadIfChanged());
        Assert.Equal("from-b", Assert.Single(a.Entries).Username);
        Assert.False(a.ReloadIfChanged());
    }

    [Fact]
    public void Update_merges_on_top_of_other_instance_write()
    {
        var path = _tmp.File();
        var a = Vault.Create(path, "pw");
        var b = Vault.Open(path, a.Key);
        b.Update(l => l.Add(new Entry { Username = "b" }));
        a.Update(l => l.Add(new Entry { Username = "a" })); // a has stale view; must not drop b's entry

        Assert.Equal(["b", "a"], Vault.Open(path, a.Key).Entries.Select(e => e.Username));
    }

    [Fact]
    public void ChangePassword_old_fails_new_opens()
    {
        var path = _tmp.File();
        var v = Vault.Create(path, "eski");
        v.Update(l => l.Add(new Entry { Username = "u" }));
        var oldSalt = v.Salt;

        v.ChangePassword("yeni");

        Assert.NotEqual(oldSalt, v.Salt);
        Assert.Equal(v.Salt, Vault.ReadSalt(path));
        Assert.ThrowsAny<CryptographicException>(() => Vault.Open(path, "eski"));
        Assert.Equal("u", Assert.Single(Vault.Open(path, "yeni").Entries).Username);
    }

    [Fact]
    public void FullName_is_not_serialized_and_trims()
    {
        Assert.Equal("Ahmet", new Entry { FirstName = "Ahmet" }.FullName);
        var path = _tmp.File();
        var v = Vault.Create(path, "pw");
        v.Update(l => l.Add(new Entry { FirstName = "A", LastName = "B", Site = "x.com" }));
        Assert.Equal("A B", Vault.Open(path, v.Key).Entries[0].FullName);
        Assert.Equal("x.com", Vault.Open(path, v.Key).Entries[0].Site);
    }

    [Theory]
    [InlineData(".bak")]
    [InlineData(".tmp")]
    public void Create_refuses_to_overwrite_leftover_backup(string suffix)
    {
        // vault.ezp missing next to .bak/.tmp = an interrupted save; a new vault there would overwrite the only copy
        var path = _tmp.File();
        File.WriteAllText(path + suffix, "old vault");
        Assert.Throws<IOException>(() => Vault.Create(path, "pw"));
        Assert.Equal("old vault", File.ReadAllText(path + suffix));
    }

    [Fact]
    public void Failed_update_leaves_memory_as_on_disk()
    {
        var path = _tmp.File();
        var v = Vault.Create(path, "pw");
        v.Update(l => l.Add(new Entry { Username = "u", Password = "old" }));
        Directory.CreateDirectory(path + ".tmp"); // the temp file can no longer be written
        Assert.ThrowsAny<Exception>(() => v.Update(l => l[0].Password = "new"));
        Assert.Equal("old", Assert.Single(v.Entries).Password);
    }

    [Fact]
    public void Save_waits_for_a_reader_briefly_holding_the_file()
    {
        if (!OperatingSystem.IsWindows()) return; // Unix rename ignores open handles; Windows refuses to replace an open file
        var path = _tmp.File();
        var v = Vault.Create(path, "pw");
        var reader = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        // own thread, not the pool: on a busy CI runner a pool-scheduled release came later than the 5 × 100 ms retries
        var release = new Thread(() => { Thread.Sleep(150); reader.Dispose(); });
        release.Start();
        try { v.Update(l => l.Add(new Entry { Username = "u" })); }
        finally { release.Join(); }
        Assert.Equal("u", Assert.Single(Vault.Open(path, v.Key).Entries).Username);
    }

    [Fact]
    public void Password_change_elsewhere_throws_VaultPasswordChangedException()
    {
        var path = _tmp.File();
        var a = Vault.Create(path, "eski");
        Vault.Open(path, a.Key).ChangePassword("yeni");
        Assert.Throws<VaultPasswordChangedException>(() => a.ReloadIfChanged());
    }

    [Fact]
    public void Half_written_file_is_read_again_before_failing()
    {
        var path = _tmp.File();
        var a = Vault.Create(path, "pw");
        Vault.Open(path, a.Key).Update(l => l.Add(new Entry { Username = "b" }));
        var good = File.ReadAllBytes(path);
        File.WriteAllBytes(path, good[..^5]); // another process is still writing
        // own thread, not the pool: on a busy CI runner a pool-scheduled write came after the 200 ms re-read
        var finish = new Thread(() => { Thread.Sleep(50); File.WriteAllBytes(path, good); });
        finish.Start();

        try { Assert.True(a.ReloadIfChanged()); }
        finally { finish.Join(); }
        Assert.Equal("b", Assert.Single(a.Entries).Username);
    }

    [Fact]
    public void Corrupt_file_is_not_a_password_change_and_keeps_entries()
    {
        var path = _tmp.File();
        var a = Vault.Create(path, "pw");
        a.Update(l => l.Add(new Entry { Username = "a" }));
        Vault.Open(path, a.Key).Update(l => l.Add(new Entry { Username = "b" }));
        var good = File.ReadAllBytes(path);
        var bad = (byte[])good.Clone();
        bad[^1] ^= 1;
        File.WriteAllBytes(path, bad);

        var e = Assert.ThrowsAny<CryptographicException>(() => a.ReloadIfChanged());
        Assert.IsNotType<VaultPasswordChangedException>(e);
        Assert.Equal("a", Assert.Single(a.Entries).Username);
        File.WriteAllBytes(path, good);
        Assert.True(a.ReloadIfChanged()); // the failed read did not mark the file as seen
        Assert.Equal(["a", "b"], a.Entries.Select(x => x.Username));
    }

    [Fact]
    public void ReloadIfChanged_sees_same_length_write_within_one_timestamp_tick()
    {
        // FAT/exFAT and some network drives store mtime in 2 s steps
        var path = _tmp.File();
        var a = Vault.Create(path, "pw");
        a.Update(l => l.Add(new Entry { Username = "u", Password = "p1" }));
        var t = File.GetLastWriteTimeUtc(path);
        var b = Vault.Open(path, a.Key);
        b.Update(l => l[0].Password = "p2");
        File.SetLastWriteTimeUtc(path, t);

        Assert.True(a.ReloadIfChanged());
        Assert.Equal("p2", Assert.Single(a.Entries).Password);
    }
}

public class SitesTests
{
    [Theory]
    [InlineData("https://www.X.com:8443/login?a=1", "x.com")]
    [InlineData("  Portal.X.com/login ", "portal.x.com")]
    [InlineData("x.com:8080", "x.com")]
    [InlineData("WWW.x.com", "x.com")]
    [InlineData("", "")]
    public void Normalize(string input, string expected) => Assert.Equal(expected, Sites.Normalize(input));

    [Theory]
    [InlineData("x.com", "x.com", true)]
    [InlineData("x.com", "portal.x.com", true)]
    [InlineData("x.com", "https://www.x.com/a", true)]
    [InlineData("portal.x.com", "x.com", false)]
    [InlineData("x.com", "evilx.com", false)]
    [InlineData("x.com", "x.com.evil.io", false)]
    [InlineData("", "x.com", false)]
    [InlineData("", "", false)]
    public void Matches(string entrySite, string pageHost, bool expected) => Assert.Equal(expected, Sites.Matches(entrySite, pageHost));
}

public class SearchTests : IDisposable
{
    readonly TempDir _tmp = new();
    readonly Vault _v;
    public void Dispose() => _tmp.Dispose();

    public SearchTests()
    {
        _v = Vault.Create(_tmp.File(), "pw");
        var t = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        _v.Update(l => l.AddRange([
            new Entry { FirstName = "Ahmet", LastName = "Yılmaz", Username = "ay01", UpdatedAt = t.AddDays(1) },
            new Entry { FirstName = "Mehmet", LastName = "Ahmetoğlu", Username = "ma02", UpdatedAt = t.AddDays(2) },
            new Entry { FirstName = "Ahmet", LastName = "Kaya", Username = "ak03", UpdatedAt = t.AddDays(3) },
            new Entry { FirstName = "Şükrü", LastName = "Çelik", Username = "sc04", Extra1 = "İstanbul", UpdatedAt = t.AddDays(4) },
            new Entry { FirstName = "Zeynep", LastName = "Demir", Username = "zd05", Extra2 = "ahmetin eşi", UpdatedAt = t.AddDays(5) },
        ]));
    }

    static string[] Names(IEnumerable<Entry> r) => r.Select(e => e.FullName).ToArray();

    [Fact]
    public void Fold_maps_turkish_and_lowercases() =>
        Assert.Equal("sukru celik istanbul igdir ogun", TextFold.Fold("ŞÜKRÜ Çelik İSTANBUL Iğdır Öğün"));

    [Fact]
    public void Fold_handles_russian() =>
        Assert.Equal("алексей семен", TextFold.Fold("АЛЕКСЕЙ Семён"));

    [Fact]
    public void Search_finds_yo_with_ye()
    {
        _v.Update(l => l.Add(new Entry { FirstName = "Семён", LastName = "Ёлкин" }));
        Assert.Equal(["Семён Ёлкин"], Names(_v.Search("семен елк")));
    }

    [Fact]
    public void Site_filter_and_site_text_search()
    {
        _v.Update(l => l.AddRange([
            new Entry { Site = "x.com", FirstName = "Ahmet", LastName = "Xli", Username = "ax" },
            new Entry { Site = "y.com", FirstName = "Ahmet", LastName = "Yli", Username = "ay" },
        ]));
        Assert.Equal(["Ahmet Xli"], Names(_v.Search("ahmet", site: "portal.x.com")));
        Assert.Equal(["Ahmet Yli"], Names(_v.Search("", site: "y.com")));
        Assert.Empty(_v.Search("ahmet", site: "evilx.com"));
        Assert.Equal(["Ahmet Yli"], Names(_v.Search("y.com"))); // app search covers site text
    }

    [Fact]
    public void Prefix_matches_first_then_alphabetical()
    {
        Assert.Equal(["Ahmet Kaya", "Ahmet Yılmaz", "Mehmet Ahmetoğlu", "Zeynep Demir"], Names(_v.Search("ahmet")));
    }

    [Fact]
    public void Search_is_case_insensitive() =>
        Assert.Equal(Names(_v.Search("ahmet")), Names(_v.Search("AHMET")));

    [Fact]
    public void Search_folds_turkish() =>
        Assert.Equal(["Şükrü Çelik"], Names(_v.Search("sukru")));

    [Fact]
    public void Search_matches_extras() =>
        Assert.Equal(["Şükrü Çelik"], Names(_v.Search("istanbul")));

    [Fact]
    public void Every_word_must_match() =>
        Assert.Equal(["Ahmet Yılmaz"], Names(_v.Search("ahmet yil")));

    [Fact]
    public void Empty_query_returns_most_recently_updated() =>
        Assert.Equal(["Zeynep Demir", "Şükrü Çelik"], Names(_v.Search("  ", 2)));

    [Fact]
    public void Limit_applies() =>
        Assert.Equal(2, _v.Search("ahmet", 2).Count);

    [Fact]
    public void Search_5000_entries_is_fast()
    {
        var v = Vault.Create(_tmp.File("big.ezp"), "pw");
        v.Update(l => { for (var i = 0; i < 5000; i++) l.Add(new Entry { FirstName = $"Ad{i}", LastName = $"Soyad{i}", Username = $"user{i}", Extra1 = "Şube Merkez" }); });
        v.Search("ad1"); // warm-up
        var sw = Stopwatch.StartNew();
        var r = v.Search("ad12 soyad");
        sw.Stop();
        Assert.NotEmpty(r);
        Assert.True(sw.ElapsedMilliseconds < 50, $"{sw.ElapsedMilliseconds} ms");
    }
}
