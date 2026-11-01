using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;
using EasyPass.Core;
using static EasyPass.App.Loc;

namespace EasyPass.App;

public partial class TasksView : UserControl
{
    const int MaxName = 100;

    internal MainWindow Main = null!;
    TextBox? input;    // the box renaming a task, if any
    string? renaming;  // its task
    readonly List<(DockPanel Row, TextBox Box)> drafts = []; // new tasks still being typed
    readonly Button addTask;

    public TasksView()
    {
        InitializeComponent();
        addTask = new Button { Style = (Style)FindResource("AddRowButton") };
        addTask.SetResourceReference(AutomationProperties.NameProperty, "TaskAdd");
        addTask.SetResourceReference(ToolTipProperty, "TaskAdd");
        addTask.Click += AddTask_Click;
    }

    /// <summary>An open box stays as typed; what arrived from disk shows when it closes.</summary>
    public void Refresh()
    {
        if (input == null && drafts.Count == 0) Rebuild();
    }

    void Rebuild()
    {
        if (Main.ActiveVault is not { } vault) return;
        TaskList.Items.Clear();
        foreach (var task in vault.Data.Tasks.Where(t => !t.Archived))
            TaskList.Items.Add(input != null && task.Id == renaming ? input : Row(task));
        foreach (var draft in drafts) TaskList.Items.Add(draft.Row);
        EmptyText.Visibility = TaskList.Items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        TaskList.Items.Add(addTask);
    }

    DockPanel Row(WorkTask task)
    {
        var row = new DockPanel();
        var delete = new Button { Margin = new Thickness(4, 0, 0, 0), Height = 26, Padding = new Thickness(10, 0, 10, 0), FontSize = 12, Style = (Style)FindResource("DangerButton") };
        delete.SetResourceReference(ContentProperty, "TaskDelete");
        delete.Click += (_, _) => Delete(task);
        var rename = new Button { Margin = new Thickness(8, 0, 0, 0), Height = 26, Padding = new Thickness(10, 0, 10, 0), FontSize = 12 };
        rename.SetResourceReference(ContentProperty, "TaskRename");
        rename.Click += (_, _) => StartInput(task.Name, task.Id);
        DockPanel.SetDock(delete, Dock.Right);
        DockPanel.SetDock(rename, Dock.Right);
        row.Children.Add(delete);
        row.Children.Add(rename);
        row.Children.Add(new TextBlock { Text = task.Name, FontWeight = FontWeights.Medium, VerticalAlignment = VerticalAlignment.Center, TextWrapping = TextWrapping.Wrap });
        return row;
    }

    void AddTask_Click(object sender, RoutedEventArgs e)
    {
        // no stack of empty boxes: + goes back to the one still waiting
        if (drafts.LastOrDefault() is { Box: not null } last && last.Box.Text.Trim() == "") { last.Box.Focus(); return; }
        drafts.Add(Draft());
        Rebuild();
        TaskList.ScrollIntoView(addTask);
    }

    (DockPanel, TextBox) Draft()
    {
        var row = new DockPanel();
        var box = new TextBox { MaxLength = MaxName };
        var add = new Button { Margin = new Thickness(8, 0, 0, 0), IsEnabled = false, Style = (Style)FindResource("AccentButton") };
        add.SetResourceReference(ContentProperty, "TaskAddConfirm");
        DockPanel.SetDock(add, Dock.Right);
        row.Children.Add(add);
        row.Children.Add(box);
        var draft = (row, box);
        FocusOnce(box);
        box.TextChanged += (_, _) => add.IsEnabled = box.Text.Trim() != "";
        add.Click += (_, _) => CommitDraft(draft);
        box.KeyDown += (_, e) =>
        {
            if (e.Key == Key.Escape) CloseDraft(draft);
            else if (e.Key == Key.Enter) CommitDraft(draft);
            else return;
            e.Handled = true;
        };
        return draft;
    }

    // Rebuild loads an open box again; only the first time may take the focus from another one
    static void FocusOnce(TextBox box)
    {
        RoutedEventHandler? focus = null;
        focus = (_, _) => { box.Loaded -= focus; box.Focus(); box.SelectAll(); };
        box.Loaded += focus;
    }

    void CloseDraft((DockPanel Row, TextBox Box) draft)
    {
        drafts.Remove(draft);
        Rebuild();
        FocusAdd();
    }

    void CommitDraft((DockPanel Row, TextBox Box) draft)
    {
        var name = draft.Box.Text.Trim();
        if (name == "") { CloseDraft(draft); return; }
        var at = drafts.IndexOf(draft);
        drafts.RemoveAt(at);
        if (!Main.Write(d => d.Tasks.Add(new WorkTask { Name = name })))
        {
            drafts.Insert(at, draft); // what was typed is not lost
            Rebuild();
            draft.Box.Focus();
            return;
        }
        Rebuild();
        FocusAdd();
    }

    // Enter again opens the next box. After layout: the rebuilt list has only just realized the button
    void FocusAdd()
    {
        TaskList.ScrollIntoView(addTask);
        Dispatcher.InvokeAsync(() => addTask.Focus(), DispatcherPriority.Loaded);
    }

    void StartInput(string text, string id)
    {
        var box = new TextBox { Text = text, MaxLength = MaxName };
        FocusOnce(box);
        box.KeyDown += Input_KeyDown;
        input = box;
        renaming = id;
        Rebuild();
    }

    void Input_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape) CloseInput();
        else if (e.Key == Key.Enter) Commit();
        else return;
        e.Handled = true;
    }

    void CloseInput()
    {
        input = null;
        renaming = null;
        Rebuild();
    }

    void Commit()
    {
        var name = input!.Text.Trim();
        var id = renaming!;
        if (name == "") { CloseInput(); return; }
        input = null;
        renaming = null;
        var saved = Main.Write(d =>
        {
            if (d.Tasks.FirstOrDefault(t => t.Id == id) is { } task) task.Name = name;
        });
        if (!saved) { StartInput(name, id); return; } // what was typed is not lost
        Rebuild();
        FocusAdd();
    }

    void Delete(WorkTask task)
    {
        var answer = Main.Ask(string.Format(L("AskDeleteTask"), task.Name), L("TaskDelete"), MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
        if (answer == MessageBoxResult.Yes) Main.Write(d => Work.ArchiveTask(d, task.Id, DateTime.UtcNow));
    }
}
