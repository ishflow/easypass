using System.Windows;
using static EasyPass.App.Loc;

namespace EasyPass.App;

/// <summary>Stays until clicked: a Windows toast would close itself (spec §5). Never shows a password.</summary>
public partial class ReminderWindow : Window
{
    readonly Action click;

    public ReminderWindow(Action click)
    {
        InitializeComponent();
        this.click = click;
    }

    public void SetReminder(string task, string customer, string login)
    {
        Heading.Text = L("NotifTitle");
        TaskText.Text = task;
        TaskText.ToolTip = task;
        CustomerText.Text = customer;
        CustomerText.ToolTip = customer;
        LoginText.Text = login;
        Fit();
    }

    // ReminderService stacks the toasts by Height, so a taller one must say so before it is placed
    void Fit()
    {
        var root = (UIElement)Content;
        root.Measure(new Size(Width, double.PositiveInfinity));
        Height = Math.Ceiling(root.DesiredSize.Height);
    }

    public void SetMore(int count)
    {
        Heading.Text = string.Format(L("NotifMore"), count);
        TopBar.Visibility = CloseButton.Visibility = TaskText.Visibility = CustomerText.Visibility = LoginText.Visibility = Visibility.Collapsed;
        Fit();
    }

    void Clicked(object sender, RoutedEventArgs e) => click();
}
