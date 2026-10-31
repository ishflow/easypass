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
    public void Vault_without_password_opens_from_the_file_alone()
    {
        var path = _tmp.File();
        var v = Vault.Create(path);
        v.Update(l => l.Add(new Entry { Username = "u", Password = "p" }));

        Assert.False(v.HasPassword);
        Assert.Equal(1, BitConverter.ToInt32(File.ReadAllBytes(path), 4)); // no secret to stretch
        var key = Vault.PasswordlessKey(path);
        Assert.Equal(v.Key, key);
        Assert.Equal("p", Assert.Single(Vault.Open(path, key!).Entries).Password);
        Assert.Equal("p", Assert.Single(Vault.Open(path, "").Entries).Password);
    }

    [Fact]
    public void Vault_with_password_has_no_passwordless_key()
    {
        var path = _tmp.File();
        Assert.True(Vault.Create(path, "pw").HasPassword);
        Assert.Null(Vault.PasswordlessKey(path));
    }

    [Fact]
    public void Removing_the_password_keeps_entries_and_the_old_password_stops_working()
    {
        var path = _tmp.File();
        var v = Vault.Create(path, "eski");
        v.Update(l => l.Add(new Entry { Username = "u" }));

        v.ChangePassword("");

        Assert.False(v.HasPassword);
        Assert.Equal("u", Assert.Single(Vault.Open(path, Vault.PasswordlessKey(path)!).Entries).Username);
        Assert.ThrowsAny<CryptographicException>(() => Vault.Open(path, "eski"));
        Assert.True(Vault.Open(path + ".bak", "eski").HasPassword); // the version before stays as .bak, still with its password
    }

    [Fact]
    public void Sign_up_fields_round_trip_and_only_open_ones_are_searchable()
    {
        var path = _tmp.File();
        var v = Vault.Create(path);
        v.Update(l => l.Add(new Entry
        {
            Site = "x.com", FirstName = "Nur", Username = "nur",
            Fields = [new() { Label = "Telefon", Value = "0532 111 22 33" }, new() { Label = "TC kimlik no", Value = "12345678901", Secret = true }],
        }));

        var e = Assert.Single(Vault.Open(path, v.Key).Entries);
        Assert.Equal([("Telefon", "0532 111 22 33", false), ("TC kimlik no", "12345678901", true)], e.Fields.Select(f => (f.Label, f.Value, f.Secret)));
        Assert.Single(v.Search("0532"));
        Assert.Empty(v.Search("12345678901")); // secret values are not searchable
    }

    [Fact]
    public void Entry_from_an_older_file_has_no_fields()
    {
        var path = _tmp.File();
        var v = Vault.Create(path);
        v.Update(l => l.Add(new Entry { Username = "u" }));
        Assert.Empty(Assert.Single(Vault.Open(path, v.Key).Entries).Fields);
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

    // The bytes v1.5 wrote: same capsule, plain text with "entries" only and no todoHidden on the entry.
    static void WriteV15File(string path, byte[] key) => WriteFile(path, key, """
            {"entries":[{"id":"old1","site":"x.com","firstName":"Ayşe","lastName":"Su","extra1":"","extra2":"","username":"ayse","password":"p",
            "fields":[{"label":"Telefon","value":"0532","secret":false}],"updatedAt":"2026-01-02T03:04:05Z"}]}
            """);

    static void WriteFile(string path, byte[] key, string json)
    {
        var plain = System.Text.Encoding.UTF8.GetBytes(json);
        var file = File.ReadAllBytes(path);
        var data = new byte[24 + 12 + 16 + plain.Length];
        file.AsSpan(0, 24).CopyTo(data);
        RandomNumberGenerator.Fill(data.AsSpan(24, 12));
        using (var aes = new AesGcm(key, 16))
            aes.Encrypt(data.AsSpan(24, 12), plain, data.AsSpan(24 + 12 + 16), data.AsSpan(24 + 12, 16), data.AsSpan(0, 24));
        File.WriteAllBytes(path, data);
    }

    [Fact]
    public void Old_v15_file_opens_with_empty_tasks_work_reminders()
    {
        var path = _tmp.File();
        var key = Vault.Create(path, "pw").Key;
        WriteV15File(path, key);

        var v = Vault.Open(path, key);
        var e = Assert.Single(v.Entries);
        Assert.Equal(("old1", "x.com", "Ayşe", "ayse", "p", false), (e.Id, e.Site, e.FirstName, e.Username, e.Password, e.TodoHidden));
        Assert.Equal("0532", Assert.Single(e.Fields).Value);
        Assert.Empty(v.Data.Tasks);
        Assert.Empty(v.Data.Work);
        Assert.Empty(v.Data.Reminders);

        v.Update(d => d.Tasks.Add(new WorkTask { Name = "НДС" })); // first new field written: nothing of the old data is lost
        var w = Vault.Open(path, key);
        Assert.Equal("p", Assert.Single(w.Entries).Password);
        Assert.Equal("НДС", Assert.Single(w.Data.Tasks).Name);
    }

    [Fact]
    public void V16_file_without_task_lists_loads_as_not_chosen_and_keeps_a_list_once_chosen()
    {
        var path = _tmp.File();
        var key = Vault.Create(path, "pw").Key;
        WriteFile(path, key, """
            {"entries":[{"id":"e1","site":"x.com","username":"u","password":"p","todoHidden":false,"updatedAt":"2026-01-02T03:04:05Z"}],
             "tasks":[{"id":"t1","name":"НДС","archived":false},{"id":"t2","name":"Страховка","archived":false}],
             "work":[{"entryId":"e1","month":"2026-11","tasks":{"t1":"done"},"updatedAt":"2026-11-02T03:04:05Z"}],
             "reminders":[]}
            """);

        var v = Vault.Open(path, key);
        Assert.Null(Assert.Single(v.Entries).TaskIds);
        Assert.Empty(Work.TasksOf(v.Data, v.Entries[0]));
        Assert.Equal(TodoGroup.Done, Assert.Single(Work.Todo(v.Data, "2026-11").Rows).Group); // the old rule

        v.Update(d => Work.Assign(d, "e1", ["t1", "t2"], DateTime.UtcNow));
        var w = Vault.Open(path, key);
        Assert.Equal(["t1", "t2"], Assert.Single(w.Entries).TaskIds);
        Assert.Equal(TodoGroup.Unfinished, Assert.Single(Work.Todo(w.Data, "2026-11").Rows).Group);
    }

    static (Vault V, string EntryId, string TaskId) WithWork(string path)
    {
        var v = Vault.Create(path, "pw");
        var e = new Entry { Username = "u", TodoHidden = true };
        var t = new WorkTask { Name = "НДС" };
        var due = new DateTime(2026, 11, 5, 9, 0, 0, DateTimeKind.Utc);
        v.Update(d =>
        {
            d.Entries.Add(e);
            d.Tasks.Add(t);
            d.Work.Add(new WorkRecord { EntryId = e.Id, Month = "2026-11", Tasks = new() { [t.Id] = "partial" }, UpdatedAt = due });
            d.Reminders.Add(new Reminder { EntryId = e.Id, TaskId = t.Id, Month = "2026-11", DueAt = due });
        });
        return (v, e.Id, t.Id);
    }

    [Fact]
    public void New_lists_round_trip_through_the_encrypted_file()
    {
        var path = _tmp.File();
        var (v, entryId, taskId) = WithWork(path);

        var d = Vault.Open(path, v.Key).Data;
        Assert.True(Assert.Single(d.Entries).TodoHidden);
        Assert.Equal(taskId, Assert.Single(d.Tasks).Id);
        var w = Assert.Single(d.Work);
        Assert.Equal((entryId, "2026-11", "partial"), (w.EntryId, w.Month, w.Tasks[taskId]));
        var r = Assert.Single(d.Reminders);
        Assert.Equal(new DateTime(2026, 11, 5, 9, 0, 0, DateTimeKind.Utc), r.DueAt);
        Assert.Equal(DateTimeKind.Utc, r.DueAt.Kind);
        Assert.Null(r.DismissedAt);
        Assert.Null(r.ResolvedAt);
    }

    [Fact]
    public void Failed_update_leaves_work_as_on_disk()
    {
        var path = _tmp.File();
        var (v, _, taskId) = WithWork(path);
        Directory.CreateDirectory(path + ".tmp"); // the temp file can no longer be written

        Assert.ThrowsAny<Exception>(() => v.Update(d =>
        {
            d.Tasks[0].Name = "changed";
            d.Tasks.Clear();
            d.Work[0].Tasks[taskId] = "done";
            d.Work[0].Month = "1999-01";
            d.Reminders[0].DismissedAt = DateTime.UtcNow;
            d.Entries[0].TodoHidden = false;
        }));

        Assert.Equal("НДС", Assert.Single(v.Data.Tasks).Name);
        var w = Assert.Single(v.Data.Work);
        Assert.Equal(("2026-11", "partial"), (w.Month, w.Tasks[taskId]));
        Assert.Null(Assert.Single(v.Data.Reminders).DismissedAt);
        Assert.True(Assert.Single(v.Entries).TodoHidden);
    }

    [Fact]
    public void Entries_only_update_keeps_the_other_lists()
    {
        var path = _tmp.File();
        var (v, _, _) = WithWork(path);
        v.Update(l => l.Add(new Entry { Username = "b" }));

        var d = Vault.Open(path, v.Key).Data;
        Assert.Equal(2, d.Entries.Count);
        Assert.Single(d.Tasks);
        Assert.Single(d.Work);
        Assert.Single(d.Reminders);
    }

    [Fact]
    public void Change_password_keeps_the_other_lists()
    {
        var path = _tmp.File();
        WithWork(path).V.ChangePassword("yeni");
        Assert.Single(Vault.Open(path, "yeni").Data.Work);
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
    public void Search_sees_a_change_made_after_an_earlier_search()
    {
        Assert.Equal(["Şükrü Çelik"], Names(_v.Search("sukru")));
        _v.Update(l => l.Single(e => e.Username == "sc04").FirstName = "Kemal");
        Assert.Empty(_v.Search("sukru"));
        Assert.Equal(["Kemal Çelik"], Names(_v.Search("kemal")));
        Assert.Equal(["Kemal Çelik"], Names(Vault.Open(_v.Path, _v.Key).Search("kemal")));
    }

    [Fact]
    public void Failed_update_does_not_change_what_search_finds()
    {
        _v.Search("sukru");
        Directory.CreateDirectory(_v.Path + ".tmp"); // the save will fail
        Assert.ThrowsAny<Exception>(() => _v.Update(l => l.Single(e => e.Username == "sc04").FirstName = "Kemal"));
        Directory.Delete(_v.Path + ".tmp");
        Assert.Equal(["Şükrü Çelik"], Names(_v.Search("sukru")));
        Assert.Empty(_v.Search("kemal"));
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
