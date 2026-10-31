using System.Windows;
using System.Windows.Controls;
using EasyPass.Core;

namespace EasyPass.App;

/// <summary>Pool tasks the client does not have yet, as a scrollable checklist (spec §13).</summary>
public partial class PickTasksWindow : Window
{
    readonly List<(CheckBox Box, string Id)> boxes = [];

    public List<string> Chosen { get; private set; } = [];

    public PickTasksWindow(IEnumerable<WorkTask> candidates)
    {
        InitializeComponent();
        foreach (var task in candidates)
        {
            var box = new CheckBox { Content = task.Name };
            box.Click += (_, _) => SaveButton.IsEnabled = boxes.Any(b => b.Box.IsChecked == true);
            boxes.Add((box, task.Id));
            Boxes.Children.Add(box);
        }
    }

    void Save_Click(object sender, RoutedEventArgs e)
    {
        Chosen = [.. boxes.Where(b => b.Box.IsChecked == true).Select(b => b.Id)];
        DialogResult = true;
    }
}
