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
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    [JsonIgnore] public string FullName => $"{FirstName} {LastName}".Trim();
}

// File: "EZP1" | iterations int32 LE | salt 16 | nonce 12 | tag 16 | AES-256-GCM(JSON {"entries":[...]}), AAD = first 24 bytes.
public sealed class Vault
{
    const int Iterations = 600_000, HeaderLen = 24, NonceLen = 12, TagLen = 16;
    static readonly byte[] Magic = "EZP1"u8.ToArray();
    static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    sealed record Doc(List<Entry> Entries);

    List<Entry> _entries = [];
    int _iterations;
    (DateTime, long) _stamp;

    public string Path { get; }
    public IReadOnlyList<Entry> Entries => _entries;
    public byte[] Salt { get; private set; }
    public byte[] Key { get; private set; }

    Vault(string path, int iterations, byte[] salt, byte[] key)
    {
        Path = System.IO.Path.GetFullPath(path);
        _iterations = iterations;
        Salt = salt;
        Key = key;
    }

    public static Vault Create(string path, string password)
    {
        if (File.Exists(path)) throw new IOException($"Dosya zaten var: {path}");
        var salt = RandomNumberGenerator.GetBytes(16);
        var v = new Vault(path, Iterations, salt, Derive(password, salt, Iterations));
        Locked(() => v.Save([]));
        return v;
    }

    public static Vault Open(string path, string password)
    {
        var (iterations, salt) = ReadHeader(File.ReadAllBytes(path));
        var v = new Vault(path, iterations, salt, Derive(password, salt, iterations));
        v.Load();
        return v;
    }

    public static Vault Open(string path, byte[] key)
    {
        var (iterations, salt) = ReadHeader(File.ReadAllBytes(path));
        var v = new Vault(path, iterations, salt, key);
        v.Load();
        return v;
    }

    public static byte[] ReadSalt(string path)
    {
        var head = new byte[HeaderLen];
        using (var f = File.OpenRead(path)) f.ReadExactly(head);
        return ReadHeader(head).Salt;
    }

    public bool ReloadIfChanged()
    {
        var fi = new FileInfo(Path);
        if (!fi.Exists || (fi.LastWriteTimeUtc, fi.Length) == _stamp) return false;
        Load();
        return true;
    }

    public void Update(Action<List<Entry>> change) => Locked(() =>
    {
        ReloadIfChanged();
        var list = new List<Entry>(_entries);
        change(list);
        Save(list);
    });

    public void ChangePassword(string newPassword) => Locked(() =>
    {
        ReloadIfChanged();
        var old = (Salt, Key, _iterations);
        var salt = RandomNumberGenerator.GetBytes(16);
        (Salt, Key, _iterations) = (salt, Derive(newPassword, salt, Iterations), Iterations);
        try { Save(_entries); }
        catch { (Salt, Key, _iterations) = old; throw; }
    });

    public IReadOnlyList<Entry> Search(string query, int limit = 20, string? site = null)
    {
        var pool = site is null ? _entries : _entries.Where(e => Sites.Matches(e.Site, site));
        var words = TextFold.Fold(query).Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (words.Length == 0) return pool.OrderByDescending(e => e.UpdatedAt).Take(limit).ToList();
        var first = words[0];
        return pool
            .Select(e => (e, text: TextFold.Fold($"{e.FirstName} {e.LastName} {e.Username} {e.Extra1} {e.Extra2} {e.Site}")))
            .Where(x => words.All(w => x.text.Contains(w, StringComparison.Ordinal)))
            .OrderBy(x => TextFold.Fold(x.e.FirstName).StartsWith(first, StringComparison.Ordinal)
                       || TextFold.Fold(x.e.LastName).StartsWith(first, StringComparison.Ordinal) ? 0 : 1)
            .ThenBy(x => TextFold.Fold(x.e.FullName), StringComparer.Ordinal)
            .Take(limit)
            .Select(x => x.e)
            .ToList();
    }

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

    void Load()
    {
        var fi = new FileInfo(Path);
        var stamp = (fi.LastWriteTimeUtc, fi.Length);
        var data = File.ReadAllBytes(Path);
        var (_, salt) = ReadHeader(data);
        if (data.Length < HeaderLen + NonceLen + TagLen) throw new InvalidDataException("Kasa dosyası eksik.");
        if (!salt.AsSpan().SequenceEqual(Salt))
            throw new CryptographicException("Kasanın ana şifresi değişmiş; yeniden açın.");
        var nonce = data.AsSpan(HeaderLen, NonceLen);
        var tag = data.AsSpan(HeaderLen + NonceLen, TagLen);
        var cipher = data.AsSpan(HeaderLen + NonceLen + TagLen);
        var plain = new byte[cipher.Length];
        using (var aes = new AesGcm(Key, TagLen)) aes.Decrypt(nonce, cipher, tag, plain, data.AsSpan(0, HeaderLen));
        _entries = JsonSerializer.Deserialize<Doc>(plain, Json)?.Entries ?? [];
        _stamp = stamp;
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
        if (!File.Exists(Path)) File.Move(tmp, Path);
        else
        {
            try { File.Replace(tmp, Path, Path + ".bak"); }
            catch (Exception e) when (e is IOException or PlatformNotSupportedException or UnauthorizedAccessException)
            {
                // some cloud drives reject Replace; copy keeps both .bak and the new file intact
                File.Copy(Path, Path + ".bak", true);
                File.Copy(tmp, Path, true);
                File.Delete(tmp);
            }
        }
        _entries = entries;
        var fi = new FileInfo(Path);
        _stamp = (fi.LastWriteTimeUtc, fi.Length);
    }

    static void Locked(Action action)
    {
        using var m = new Mutex(false, "EasyPass.Vault");
        try { m.WaitOne(); } catch (AbandonedMutexException) { } // previous owner died; we own it now
        try { action(); } finally { m.ReleaseMutex(); }
    }
}
