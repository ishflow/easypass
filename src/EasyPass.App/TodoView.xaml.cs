using System.Windows;
using System.Windows.Controls;
using System.Windows.Data;
using System.Windows.Input;
using EasyPass.Core;
using static EasyPass.App.Loc;

namespace EasyPass.App;

public partial class TodoView : UserControl
{
    internal MainWindow Main = null!;
    int monthsBack; // from today, so a window left open past midnight on the 31st moves on by itself
    VaultData? listedData; // an instance never changes once in the vault
    string listedMonth = "";
    TodoList? list;

    public TodoView()
    {
        InitializeComponent();
        // an Auto row sets no limit of its own: without this one the done list would not scroll or virtualize
        SizeChanged += (_, _) => { if (Window.GetWindow(this) is { } window) DonePane.MaxHeight = window.ActualHeight * 0.3; };
    }

    public void Refresh()
    {
        if (Main.ActiveVault is not { } vault) return;
        var month = Work.MonthOf(DateTime.Now.AddMonths(-monthsBack));
        // typing filters the same list: no need to work it out again on every key
        if (list == null || listedData != vault.Data || listedMonth != month)
            (list, listedData, listedMonth) = (Work.Todo(vault.Data, month), vault.Data, month);

        MonthText.Text = MonthName(month);
        NextMonth.IsEnabled = monthsBack > 0;
        CountText.Text = string.Format(L("TodoTitleFmt"), list.Done, list.Rows.Count);
        ShowBar(list);

        IEnumerable<TodoRow> rows = list.Rows;
        if (!string.IsNullOrWhiteSpace(TodoSearch.Text))
        {
            var found = vault.Search(TodoSearch.Text, vault.Entries.Count).Select(e => e.Id).ToHashSet();
            rows = rows.Where(r => found.Contains(r.Entry.Id));
        }
        var names = new Dictionary<TodoGroup, string>
        {
            [TodoGroup.NotStarted] = L("TodoNotStarted"),
            [TodoGroup.Unfinished] = L("TodoUnfinished"),
            [TodoGroup.Done] = L("TodoDone"),
        };
        var months = new Dictionary<string, string>();
        string Name(string m) => months.TryGetValue(m, out var name) ? name : months[m] = MonthName(m);
        var tasks = vault.Data.Tasks;
        var items = rows.Select(r => new TodoItem(r.Entry.Id, r.Entry.FullName == "" ? r.Entry.Username : r.Entry.FullName, r.Entry.Username, names[r.Group], r.Group,
            r.LastMonth == null ? null : MonthMarks.Of(tasks, Name(r.LastMonth), r.LastTasks), MonthMarks.Of(tasks, Name(month), r.ThisTasks))).ToList();

        var done = items.Where(i => i.Kind == TodoGroup.Done).ToList();
        DoneList.ItemsSource = done;
        DoneCount.Text = done.Count.ToString();
        DonePane.Visibility = done.Count > 0 ? Visibility.Visible : Visibility.Collapsed;

        var view = new ListCollectionView(items.Where(i => i.Kind != TodoGroup.Done).ToList());
        view.GroupDescriptions.Add(new PropertyGroupDescription(nameof(TodoItem.Group)));
        TodoList.ItemsSource = view;
        EmptyText.Visibility = list.Rows.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
    }

    /// <summary>Legend numbers and the bar; the rounded ends go to the first and last non-empty part.</summary>
    void ShowBar(TodoList l)
    {
        (LegendDone.Text, LegendWarn.Text, LegendNone.Text) = (l.Done.ToString(), l.Unfinished.ToString(), l.NotStarted.ToString());
        System.Windows.Automation.AutomationProperties.SetName(BarGrid,
            $"{L("TodoDone")} {l.Done}, {L("TodoUnfinished")} {l.Unfinished}, {L("TodoNotStarted")} {l.NotStarted}");
        var parts = new[] { (Col: BarDoneCol, Part: BarDone, N: l.Done), (Col: BarWarnCol, Part: BarWarn, N: l.Unfinished), (Col: BarNoneCol, Part: BarNone, N: l.NotStarted) };
        var shown = parts.Where(p => p.N > 0).ToList();
        foreach (var (col, part, n) in parts)
        {
            col.Width = new GridLength(n, GridUnitType.Star);
            var (first, last) = (shown.Count > 0 && shown[0].Part == part, shown.Count > 0 && shown[^1].Part == part);
            part.CornerRadius = new CornerRadius(first ? 4 : 0, last ? 4 : 0, last ? 4 : 0, first ? 4 : 0);
        }
    }

    void PrevMonth_Click(object sender, RoutedEventArgs e) { monthsBack++; Refresh(); }

    void NextMonth_Click(object sender, RoutedEventArgs e) { monthsBack--; Refresh(); }

    void TodoSearch_TextChanged(object sender, TextChangedEventArgs e) { if (Main != null) Refresh(); }

    void Row_Click(object sender, MouseButtonEventArgs e) => Open(sender);

    void Row_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && e.OriginalSource == sender) Open(sender);
    }

    void Open(object row)
    {
        if (((ListBoxItem)row).DataContext is TodoItem item) Main.OpenEntry(item.Id);
    }

    void Hide_Click(object sender, RoutedEventArgs e)
    {
        if (((Button)sender).DataContext is not TodoItem item) return;
        Main.Write(d =>
        {
            if (d.Entries.FirstOrDefault(x => x.Id == item.Id) is { } entry) entry.TodoHidden = true;
        });
    }
}
