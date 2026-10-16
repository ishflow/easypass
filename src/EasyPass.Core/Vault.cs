using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace EasyPass.Core;

public sealed class Entry
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Site { get; set; } = "";
    public string FirstName { get; set; } = "";
    public string LastName { get; set; } = "";
    public string Extra1 { get; set; } = "";
    public string Extra2 { get; set; } = "";
    public string Username { get; set; } = "";
    public string Password { get; set; } = "";
    /// <summary>What else was typed into the site's sign-up form, under the site's own labels (never the login itself).</summary>
    public List<EntryField> Fields { get; set; } = [];
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    [JsonIgnore] public string FullName => $"{FirstName} {LastName}".Trim();
    internal Entry Clone() => (Entry)MemberwiseClone(); // Fields is shared: it is replaced, never changed in place
}

/// <summary>One sign-up form field. Secret ones (ID numbers, card data…) are shown only on request.</summary>
public sealed class EntryField
{
    public string Label { get; set; } = "";
    public string Value { get; set; } = "";
    public bool Secret { get; set; }
}

// Salt differs from the open vault: the master password was changed elsewhere, the key cache is stale.
public sealed class VaultPasswordChangedException() : CryptographicException("Kasanın ana şifresi değişmiş; yeniden açın.");

// File: "EZP1" | iterations int32 LE | salt 16 | nonce 12 | tag 16 | AES-256-GCM(JSON {"entries":[...]}), AAD = first 24 bytes.
// A vault without a master password has the same format: key from the empty password with a single PBKDF2 round
// (there is no secret to stretch), so anyone with the file can open it — the price of never losing it to a forgotten password.
public sealed class Vault
{
    const int Iterations = 600_000, PasswordlessIterations = 1, HeaderLen = 24, NonceLen = 12, TagLen = 16;
    static readonly byte[] Magic = "EZP1"u8.ToArray();
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    sealed record Doc(List<Entry> Entries);

    List<Entry> _entries = [];
    int _iterations;
    byte[] _stamp = []; // header + nonce of the loaded file; every save draws a new random nonce

    public string Path { get; }
    public IReadOnlyList<Entry> Entries => _entries;
    public byte[] Salt { get; private set; }
    public byte[] Key { get; private set; }
    public bool HasPassword => _iterations != PasswordlessIterations;

    Vault(string path, int iterations, byte[] salt, byte[] key)
    {
        Path = System.IO.Path.GetFullPath(path);
        _iterations = iterations;
        Salt = salt;
        Key = key;
    }

    static int IterationsFor(string password) => password == "" ? PasswordlessIterations : Iterations;

    /// <summary>Empty password (the default) = a vault without a master password.</summary>
    public static Vault Create(string path, string password = "")
    {
        // a leftover .bak/.tmp without the vault is an interrupted save: a new vault here would overwrite the only copy
        foreach (var p in new[] { path, path + ".bak", path + ".tmp" })
            if (File.Exists(p)) throw new IOException($"Dosya zaten var: {p}");
        var salt = RandomNumberGenerator.GetBytes(16);
        var iterations = IterationsFor(password);
        var v = new Vault(path, iterations, salt, Derive(password, salt, iterations));
        Locked(() => v.Save([]));
        return v;
    }

    public static Vault Open(string path, string password) => Open(path, (salt, iterations) => Derive(password, salt, iterations));

    public static Vault Open(string path, byte[] key) => Open(path, (_, _) => key);

    static Vault Open(string path, Func<byte[], int, byte[]> key)
    {
        var data = File.ReadAllBytes(path);
        var (iterations, salt) = ReadHeader(data);
        var v = new Vault(path, iterations, salt, key(salt, iterations));
        v.Load(data);
        return v;
    }

    public static byte[] ReadSalt(string path) => ReadHeader(path).Salt;

    /// <summary>The key of a vault without a master password; null when the file has one.</summary>
    public static byte[]? PasswordlessKey(string path)
    {
        var (iterations, salt) = ReadHeader(path);
        return iterations == PasswordlessIterations ? Derive("", salt, iterations) : null;
    }

    static (int Iterations, byte[] Salt) ReadHeader(string path)
    {
        var head = new byte[HeaderLen];
        using (var f = File.OpenRead(path)) f.ReadExactly(head);
        return ReadHeader(head);
    }

    public bool ReloadIfChanged()
    {
        if (!File.Exists(Path) || ReadStamp().SequenceEqual(_stamp)) return false;
        try { Load(File.ReadAllBytes(Path)); }
        catch (Exception e) when (e is IOException or InvalidDataException or CryptographicException and not VaultPasswordChangedException)
        {
            // readers take no mutex: another process (copy fallback, cloud client) may be mid-write, so look once more
            Thread.Sleep(200);
            Load(File.ReadAllBytes(Path));
        }
        return true;
    }

    public void Update(Action<List<Entry>> change) => Locked(() =>
    {
        ReloadIfChanged();
        // copies, so a change that fails to save leaves the in-memory entries exactly as on disk
        var list = _entries.Select(e => e.Clone()).ToList();
        change(list);
        Save(list);
    });

    /// <summary>Empty new password = remove the master password.</summary>
    public void ChangePassword(string newPassword)
    {
        // PBKDF2 outside the mutex: it takes about a second and would stall the host's writes
        var salt = RandomNumberGenerator.GetBytes(16);
        var iterations = IterationsFor(newPassword);
        var key = Derive(newPassword, salt, iterations);
        Locked(() =>
        {
            ReloadIfChanged();
            var old = (Salt, Key, _iterations);
            (Salt, Key, _iterations) = (salt, key, iterations);
            try { Save(_entries); }
            catch { (Salt, Key, _iterations) = old; throw; }
        });
    }

    public IReadOnlyList<Entry> Search(string query, int limit = 20, string? site = null)
    {
        var pool = site is null ? _entries : _entries.Where(e => Sites.Matches(e.Site, site));
        var words = TextFold.Fold(query).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0) return pool.OrderByDescending(e => e.UpdatedAt).Take(limit).ToList();
        var first = words[0];
        return pool
            // site text only in the app's search: on a page every candidate shares it (spec §5)
            .Select(e => (e, text: TextFold.Fold($"{e.FirstName} {e.LastName} {e.Username} {e.Extra1} {e.Extra2} {OpenFields(e)} {(site is null ? e.Site : "")}")))
            .Where(x => words.All(w => x.text.Contains(w, StringComparison.Ordinal)))
            .OrderBy(x => TextFold.Fold(x.e.FirstName).StartsWith(first, StringComparison.Ordinal)
                       || TextFold.Fold(x.e.LastName).StartsWith(first, StringComparison.Ordinal) ? 0 : 1)
            .ThenBy(x => TextFold.Fold(x.e.FullName), StringComparer.Ordinal)
            .Take(limit)
            .Select(x => x.e)
            .ToList();
    }

    // sign-up details are searchable too (phone, e-mail…), except the secret ones
    static string OpenFields(Entry e) => string.Join(' ', e.Fields.Where(f => !f.Secret).Select(f => f.Value));

    static byte[] Derive(string password, byte[] salt, int iterations) =>
        Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, HashAlgorithmName.SHA256, 32);

    static (int Iterations, byte[] Salt) ReadHeader(byte[] data)
    {
        if (data.Length < HeaderLen || !data.AsSpan(0, 4).SequenceEqual(Magic))
            throw new InvalidDataException("EasyPass kasa dosyası değil.");
        var iterations = BinaryPrimitives.ReadInt32LittleEndian(data.AsSpan(4));
        // the header is attacker-controllable before the tag is checked: refuse absurd work factors
        if (iterations is < 1 or > 10_000_000) throw new InvalidDataException("Geçersiz kasa başlığı.");
        return (iterations, data[8..HeaderLen]);
    }

    byte[] ReadStamp()
    {
        var head = new byte[HeaderLen + NonceLen];
        using var f = File.OpenRead(Path);
        return head[..f.ReadAtLeast(head, head.Length, throwOnEndOfStream: false)];
    }

    void Load(byte[] data)
    {
        var (_, salt) = ReadHeader(data);
        if (data.Length < HeaderLen + NonceLen + TagLen) throw new InvalidDataException("Kasa dosyası eksik.");
        if (!salt.AsSpan().SequenceEqual(Salt)) throw new VaultPasswordChangedException();
        var nonce = data.AsSpan(HeaderLen, NonceLen);
        var tag = data.AsSpan(HeaderLen + NonceLen, TagLen);
        var cipher = data.AsSpan(HeaderLen + NonceLen + TagLen);
        var plain = new byte[cipher.Length];
        using (var aes = new AesGcm(Key, TagLen)) aes.Decrypt(nonce, cipher, tag, plain, data.AsSpan(0, HeaderLen));
        _entries = JsonSerializer.Deserialize<Doc>(plain, Json)?.Entries ?? [];
        _stamp = data[..(HeaderLen + NonceLen)];
    }

    void Save(List<Entry> entries)
    {
        var plain = JsonSerializer.SerializeToUtf8Bytes(new Doc(entries), Json);
        var data = new byte[HeaderLen + NonceLen + TagLen + plain.Length];
        Magic.CopyTo(data, 0);
        BinaryPrimitives.WriteInt32LittleEndian(data.AsSpan(4), _iterations);
        Salt.CopyTo(data, 8);
        RandomNumberGenerator.Fill(data.AsSpan(HeaderLen, NonceLen));
        using (var aes = new AesGcm(Key, TagLen))
            aes.Encrypt(data.AsSpan(HeaderLen, NonceLen), plain, data.AsSpan(HeaderLen + NonceLen + TagLen),
                data.AsSpan(HeaderLen + NonceLen, TagLen), data.AsSpan(0, HeaderLen));

        var tmp = Path + ".tmp";
        using (var f = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            f.Write(data);
            f.Flush(true);
        }
        // Windows refuses to replace a file that a reader (host, cloud client, antivirus) holds open: retry briefly
        for (var attempt = 1; ; attempt++)
        {
            try { Replace(tmp); break; }
            catch (Exception e) when (attempt < 5 && e is IOException or UnauthorizedAccessException) { Thread.Sleep(100); }
        }
        _entries = entries;
        _stamp = data[..(HeaderLen + NonceLen)];
    }

    void Replace(string tmp)
    {
        if (!File.Exists(Path)) { File.Move(tmp, Path); return; }
        try { File.Replace(tmp, Path, Path + ".bak"); }
        catch (Exception e) when (e is IOException or PlatformNotSupportedException or UnauthorizedAccessException)
        {
            // Some cloud drives reject Replace, and a half-done Replace may already have moved the vault to .bak.
            // Move (MoveFileEx REPLACE_EXISTING / rename) swaps the file in atomically; tmp survives any failure.
            if (File.Exists(Path)) File.Copy(Path, Path + ".bak", true);
            File.Move(tmp, Path, overwrite: true);
        }
    }

    static void Locked(Action action)
    {
        using var m = new Mutex(false, "EasyPass.Vault");
        try { m.WaitOne(); } catch (AbandonedMutexException) { } // previous owner died; we own it now
        try { action(); } finally { m.ReleaseMutex(); }
    }
}
