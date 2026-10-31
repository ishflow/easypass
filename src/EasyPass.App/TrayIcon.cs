using System.Drawing;
using System.Windows;
using System.Windows.Forms;
using static EasyPass.App.Loc;

namespace EasyPass.App;

/// <summary>D's surfaces and lines on the WinForms menu.</summary>
sealed class MenuColors : ProfessionalColorTable
{
    public override Color ToolStripDropDownBackground => Color.White;
    public override Color MenuBorder => Color.FromArgb(0xD3, 0xD8, 0xE1);
    public override Color MenuItemBorder => Color.FromArgb(0xEE, 0xF0, 0xF4);
    public override Color MenuItemSelected => Color.FromArgb(0xEE, 0xF0, 0xF4);
}

sealed class TrayIcon : IDisposable
{
    readonly NotifyIcon icon = new();
    readonly ToolStripMenuItem open, exit;

    public TrayIcon(MainWindow main)
    {
        using (var stream = System.Windows.Application.GetResourceStream(new Uri("pack://application:,,,/EasyPass;component/app.ico")).Stream)
            icon.Icon = new System.Drawing.Icon(stream, SystemInformation.SmallIconSize);
        open = new ToolStripMenuItem("", null, (_, _) => main.ShowFromTray());
        exit = new ToolStripMenuItem("", null, (_, _) => main.Quit());
        icon.ContextMenuStrip = new ContextMenuStrip { Renderer = new ToolStripProfessionalRenderer(new MenuColors()) { RoundedEdges = false }, ShowImageMargin = false, ForeColor = Color.FromArgb(0x16, 0x19, 0x1F) };
        icon.ContextMenuStrip.Items.AddRange([open, exit]);
        icon.DoubleClick += (_, _) => main.ShowFromTray();
        icon.Visible = true;
    }

    /// <summary>Also picks up a language change.</summary>
    public void Refresh(bool locked)
    {
        open.Text = L("TrayOpen");
        exit.Text = L("TrayExit");
        icon.Text = locked ? L("TrayLocked") : "EasyPass";
    }

    public void Dispose()
    {
        icon.Visible = false; // otherwise a dead icon stays in the tray until the mouse passes over it
        icon.Dispose();
    }
}
