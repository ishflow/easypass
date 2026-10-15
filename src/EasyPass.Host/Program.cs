using System.Buffers.Binary;
using System.Text.Json;
using System.Text.Json.Nodes;
using EasyPass.Core;

namespace EasyPass.Host;

public static class NativeFrame
{
    const int MaxLen = 1024 * 1024;

    // null = stdin closed (Chrome disconnected)
    public static byte[]? Read(Stream input)
    {
        var len = new byte[4];
        if (input.ReadAtLeast(len, 4, throwOnEndOfStream: false) < 4) return null;
        var n = BinaryPrimitives.ReadInt32LittleEndian(len);
        if (n is < 0 or > MaxLen) throw new InvalidDataException($"Çerçeve boyu geçersiz: {n}");
        var body = new byte[n];
        input.ReadExactly(body);
        return body;
    }

    public static void Write(Stream output, JsonNode message)
    {
        var body = JsonSerializer.SerializeToUtf8Bytes(message);
        var len = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(len, body.Length);
        output.Write(len);
        output.Write(body);
        output.Flush();
    }
}

public static class Program
{
    static Vault? _vault;

    public static void Main()
    {
        Console.SetOut(Console.Error); // stdout carries frames only; stray writes go to stderr
        using var stdin = Console.OpenStandardInput();
        using var stdout = Console.OpenStandardOutput();
        while (NativeFrame.Read(stdin) is { } body)
        {
            JsonObject? request;
            try { request = JsonNode.Parse(body) as JsonObject; } catch (JsonException) { request = null; }
            NativeFrame.Write(stdout, request is null
                ? new JsonObject { ["id"] = null, ["ok"] = false, ["error"] = "bad_request" }
                : HostApi.Handle(request, GetVault));
        }
    }

    // Re-checked every request so "Kilitle" in the app or switching vaults takes effect immediately.
    static Vault? GetVault()
    {
        try
        {
            var path = AppPaths.VaultPath;
            if (path is null || !File.Exists(path)) return _vault = null;
            var key = KeyCache.Load(Vault.ReadSalt(path));
            if (key is null) return _vault = null;
            if (_vault is not null && _vault.Path == Path.GetFullPath(path) && _vault.Key.AsSpan().SequenceEqual(key))
                _vault.ReloadIfChanged();
            else
                _vault = Vault.Open(path, key);
            return _vault;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine(e.Message);
            return _vault = null;
        }
    }
}
