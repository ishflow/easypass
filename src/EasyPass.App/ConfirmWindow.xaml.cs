using System.Windows;

namespace EasyPass.App;

/// <summary>A themed yes/no question, centered on the program window (spec §14).</summary>
public partial class ConfirmWindow : Window
{
    public ConfirmWindow(string text)
    {
        InitializeComponent();
        Message.Text = text;
    }

    void Yes_Click(object sender, RoutedEventArgs e) => DialogResult = true;
}
