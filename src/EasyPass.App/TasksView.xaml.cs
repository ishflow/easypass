using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using EasyPass.Core;
using static EasyPass.App.Loc;

namespace EasyPass.App;

public partial class TasksView : UserControl
{
    const int MaxName = 100;

    internal MainWindow Main = null!;
    TextBox? input;    // the open inline box, if any
    string? renaming;  // its task; null = a new task

    public TasksView() => InitializeComponent();

    /// <summary>An open box stays as typed; what arrived from disk shows when it closes.</summary>
    public void Refresh()
    {
        if (input == null) Rebuild();
    }

    void Rebuild()
    {
        if (Main.ActiveVault is not { } vault) return;
        TaskList.Items.Clear();
        foreach (var task in vault.Data.Tasks.Where(t => !t.Archived))
            TaskList.Items.Add(input != null && task.Id == renaming ? input : Row(task));
        if (input != null && renaming == null) TaskList.Items.Add(input);
        EmptyText.Visibility = TaskList.Items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
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

    void AddTask_Click(object sender, RoutedEventArgs e) => StartInput("", null);

    void StartInput(string text, string? id)
    {
        var box = new TextBox { Text = text, MaxLength = MaxName };
        box.Loaded += (_, _) => { box.Focus(); box.SelectAll(); };
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
        var id = renaming;
        if (name == "") { CloseInput(); return; }
        input = null;
        renaming = null;
        var saved = Main.Write(d =>
        {
            if (id == null) d.Tasks.Add(new WorkTask { Name = name });
            else if (d.Tasks.FirstOrDefault(t => t.Id == id) is { } task) task.Name = name;
        });
        if (!saved) { StartInput(name, id); return; } // what was typed is not lost
        Rebuild();
        AddTask.Focus(); // Enter again opens the next box
    }

    void Delete(WorkTask task)
    {
        var answer = Main.Ask(string.Format(L("AskDeleteTask"), task.Name), L("TaskDelete"), MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
        if (answer == MessageBoxResult.Yes) Main.Write(d => Work.ArchiveTask(d, task.Id, DateTime.UtcNow));
    }
}
