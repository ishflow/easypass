using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using EasyPass.Core;

namespace EasyPass.App;

// Public: WPF bindings do not see internal types.
public sealed record TaskMark(string Name, bool Done)
{
    public string Glyph => Done ? "●" : "◐";
}

public sealed record MonthMarks(string Month, IReadOnlyList<TaskMark> Tasks)
{
    /// <summary>Tasks in list order, archived ones under their name. Null when nothing is marked.</summary>
    public static MonthMarks? Of(List<WorkTask> tasks, string monthName, IReadOnlyDictionary<string, string> statuses)
    {
        var marks = tasks.Where(t => statuses.ContainsKey(t.Id)).Select(t => new TaskMark(t.Name, statuses[t.Id] == Work.Done)).ToList();
        return marks.Count == 0 ? null : new MonthMarks(monthName, marks);
    }
}

public sealed record TodoItem(string Id, string Title, string Login, string Group, TodoGroup Kind, MonthMarks? Last, MonthMarks? This);

public sealed record NotificationItem(string EntryId, string Task, string Customer, string Login, string Time, string State, string Group, bool Planned, bool Resolved);

/// <summary>Marks on one line (spec §14): a long name is cut, what does not fit becomes "+N"; the full names are tooltips.</summary>
public sealed class OneLineRow : Panel
{
    const double MoreWidth = 40; // room kept for the "+N" pill: "+99" in 12 px with its padding

    public static readonly DependencyProperty ItemsProperty = DependencyProperty.Register(nameof(Items), typeof(IReadOnlyList<TaskMark>), typeof(OneLineRow),
        new PropertyMetadata(null, (row, _) => ((OneLineRow)row).Rebuild()));

    public IReadOnlyList<TaskMark>? Items
    {
        get => (IReadOnlyList<TaskMark>?)GetValue(ItemsProperty);
        set => SetValue(ItemsProperty, value);
    }

    public DataTemplate? ItemTemplate { get; set; }
    public double MaxItemWidth { get; set; } = double.PositiveInfinity;

    readonly Border more;
    readonly TextBlock moreText = new() { FontSize = 12, FontWeight = FontWeights.Medium, VerticalAlignment = VerticalAlignment.Center };
    int shown;

    public OneLineRow()
    {
        more = new Border { Child = moreText };
        more.SetResourceReference(StyleProperty, "PillNone");
    }

    void Rebuild()
    {
        Children.Clear();
        shown = -1;
        if (Items is not { Count: > 0 } items) return;
        foreach (var item in items) Children.Add(new ContentPresenter { Content = item, ContentTemplate = ItemTemplate });
        Children.Add(more);
    }

    protected override Size MeasureOverride(Size available)
    {
        var count = Children.Count - 1;
        if (count < 1) return default;
        var limit = new Size(Math.Min(MaxItemWidth, available.Width), available.Height);
        var (total, height) = (0.0, 0.0);
        for (var i = 0; i < count; i++)
        {
            Children[i].Measure(limit);
            total += Children[i].DesiredSize.Width;
            height = Math.Max(height, Children[i].DesiredSize.Height);
        }

        var fits = 0;
        if (total <= available.Width) fits = count;
        else
        {
            total = 0;
            while (fits < count && total + Children[fits].DesiredSize.Width + MoreWidth <= available.Width) total += Children[fits++].DesiredSize.Width;
            if (fits == 0) // not even one: the first is cut further
            {
                fits = 1;
                Children[0].Measure(new Size(Math.Max(0, available.Width - MoreWidth), available.Height));
                total = Children[0].DesiredSize.Width;
            }
        }
        if (fits != shown)
        {
            shown = fits;
            moreText.Text = $"+{count - fits}";
            more.ToolTip = string.Join("\n", Items!.Skip(fits).Select(t => t.Name));
            AutomationProperties.SetName(more, (string)more.ToolTip);
        }
        more.Measure(new Size(double.PositiveInfinity, available.Height));
        if (fits < count)
        {
            total += more.DesiredSize.Width;
            height = Math.Max(height, more.DesiredSize.Height);
        }
        return new Size(Math.Min(total, available.Width), height);
    }

    protected override Size ArrangeOverride(Size size)
    {
        var count = Children.Count - 1;
        var x = 0.0;
        for (var i = 0; i <= count; i++)
        {
            var child = Children[i];
            if (i == count ? shown >= count : i >= shown) { child.Arrange(new Rect()); continue; } // size 0: clipped away
            child.Arrange(new Rect(x, (size.Height - child.DesiredSize.Height) / 2, child.DesiredSize.Width, child.DesiredSize.Height));
            x += child.DesiredSize.Width;
        }
        return size;
    }
}
