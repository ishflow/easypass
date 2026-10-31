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
        CustomerText.Text = customer;
        LoginText.Text = login;
    }

    public void SetMore(int count)
    {
        Height = 46;
        Heading.Text = string.Format(L("NotifMore"), count);
        TopBar.Visibility = CloseButton.Visibility = TaskText.Visibility = CustomerText.Visibility = LoginText.Visibility = Visibility.Collapsed;
    }

    void Clicked(object sender, RoutedEventArgs e) => click();
}
