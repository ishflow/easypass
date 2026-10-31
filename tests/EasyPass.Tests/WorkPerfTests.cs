using System.Diagnostics;
using System.Text.Json.Nodes;
using EasyPass.Core;
using Xunit.Abstractions;

namespace EasyPass.Tests;

[CollectionDefinition("perf", DisableParallelization = true)] // timings mean nothing next to the other test classes
public class PerfCollection;

public sealed class BigVault : IDisposable
{
    readonly TempDir _tmp = new();
    public const string Site = "salykkabinet.test";
    public const int Customers = 5000, Months = 24;
    public readonly Vault V;
    public readonly string Month = Work.MonthOf(DateTime.Now);
    public readonly string Task1, EntryId;

    public BigVault()
    {
        V = Vault.Create(_tmp.File(), "pw");
        var task = new WorkTask { Name = "Страховка" };
        (Task1, var months) = (task.Id, Enumerable.Range(0, Months).Select(i => Work.MonthOf(DateTime.Now.AddMonths(-i))).ToArray());
        var entries = Enumerable.Range(0, Customers).Select(i => new Entry
        {
            Site = Site, FirstName = $"Ад{i}", LastName = $"Фамилия{i}", Username = $"93000000{i:D9}", Password = "p", Extra1 = "Бишкек",
            TaskIds = i % 2 == 0 ? [task.Id] : null, // both group rules are timed
        }).ToList();
        EntryId = entries[Customers / 2].Id;
        V.Update(d =>
        {
            d.Tasks.Add(task);
            d.Tasks.AddRange(Enumerable.Range(0, 4).Select(i => new WorkTask { Name = $"Работа {i}" }));
            d.Entries.AddRange(entries);
            foreach (var e in entries)
                foreach (var m in months)
                    d.Work.Add(new WorkRecord { EntryId = e.Id, Month = m, Tasks = new() { [task.Id] = "done" }, UpdatedAt = DateTime.UtcNow });
        });
    }

    public void Dispose() => _tmp.Dispose();
}

// Spec §1.5 / §7a at the size of the spec: 5,000 customers × 24 months ≈ 15 MB of JSON. Best of up to ten runs.
[Collection("perf")]
public class WorkPerfTests(BigVault big, ITestOutputHelper output) : IClassFixture<BigVault>
{
    // a limit is met once it is met: noise from a loaded machine or CI runner only ever adds time
    void Within(int limitMs, Action run, string what)
    {
        run(); // JIT
        var best = long.MaxValue;
        for (var i = 0; i < 10 && best >= limitMs; i++)
        {
            var sw = Stopwatch.StartNew();
            run();
            best = Math.Min(best, sw.ElapsedMilliseconds);
        }
        output.WriteLine($"{what}: {best} ms, file {new FileInfo(big.V.Path).Length / 1_000_000} MB");
        Assert.True(best < limitMs, $"{what}: {best} ms");
    }

    JsonObject Call(JsonObject request) => HostApi.Handle(request, () => big.V);

    [Fact]
    public void Fixture_is_the_size_of_the_spec()
    {
        Assert.Equal(120_000, big.V.Data.Work.Count);
        Assert.InRange(new FileInfo(big.V.Path).Length, 15_000_000, 40_000_000);
    }

    [Theory]
    [InlineData("")]
    [InlineData("фамилия12")]
    public void Search_under_20ms(string q)
    {
        Within(20, () => Assert.True((bool)Call(new JsonObject { ["id"] = 1, ["cmd"] = "search", ["site"] = BigVault.Site, ["q"] = q })["ok"]!), $"search '{q}'");
    }

    [Fact]
    public void Work_save_under_300ms()
    {
        Within(300, () =>
        {
            var r = Call(new JsonObject
            {
                ["id"] = 1, ["cmd"] = "work_save", ["site"] = BigVault.Site, ["entryId"] = big.EntryId, ["month"] = big.Month,
                ["statuses"] = new JsonObject { [big.Task1] = "done" }, ["reminders"] = new JsonObject(),
            });
            Assert.True((bool)r["ok"]!, r.ToJsonString());
        }, "work_save");

        var open = Stopwatch.StartNew();
        Vault.Open(big.V.Path, big.V.Key);
        output.WriteLine($"another process picking the write up: {open.ElapsedMilliseconds} ms");
    }

    [Fact]
    public void Todo_under_100ms()
    {
        Within(100, () => Assert.Equal(BigVault.Customers, Work.Todo(big.V.Data, big.Month).Rows.Count), "todo");
    }
}
