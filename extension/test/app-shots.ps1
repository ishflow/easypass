# App window screenshots for the README (called by screenshots.mjs): starts EasyPass.exe on a demo EASYPASS_HOME,
# searches for one client and selects it, then shots the main window (app.png), Settings (settings.png), the three work
# tabs (todo.png, notifications.png, tasks.png) and the reminder window (reminder.png); -Prefix goes before each file name.
param(
    [Parameter(Mandatory)] [string] $AppHome,
    [Parameter(Mandatory)] [string] $Exe,
    [Parameter(Mandatory)] [string] $Out,
    [Parameter(Mandatory)] [string] $Search,
    [string] $Prefix = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
Add-Type @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class Shot {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
    // The visible window (DWM frame bounds, without the invisible resize border), drawn by the window itself.
    public static void Save(IntPtr h, string path) {
        RECT w, v;
        GetWindowRect(h, out w);
        DwmGetWindowAttribute(h, 9, out v, Marshal.SizeOf(typeof(RECT)));
        using (var full = new Bitmap(w.Right - w.Left, w.Bottom - w.Top)) {
            using (var g = Graphics.FromImage(full)) {
                var dc = g.GetHdc();
                PrintWindow(h, dc, 2); // PW_RENDERFULLCONTENT: WPF draws with DirectX
                g.ReleaseHdc(dc);
            }
            var crop = new Rectangle(v.Left - w.Left, v.Top - w.Top, v.Right - v.Left, v.Bottom - v.Top);
            using (var visible = full.Clone(crop, full.PixelFormat)) visible.Save(path, System.Drawing.Imaging.ImageFormat.Png);
        }
    }
}
'@ -ReferencedAssemblies System.Drawing

$A = [Windows.Automation.AutomationElement]
function Wait-For([scriptblock] $What, [string] $Name, [int] $Seconds = 15) {
    $end = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $end) { $r = & $What; if ($r) { return $r }; Start-Sleep -Milliseconds 100 }
    throw "timeout: $Name"
}
function Find-Id($root, $id) { $root.FindFirst('Descendants', (New-Object Windows.Automation.PropertyCondition($A::AutomationIdProperty, $id))) }
function Windows-Of($processId) {
    $A::RootElement.FindAll('Children', (New-Object Windows.Automation.PropertyCondition($A::ProcessIdProperty, $processId)))
}
# Same logical size on any display scale.
function Set-Size($el, $w, $h) {
    $hwnd = [IntPtr]$el.Current.NativeWindowHandle
    $k = [Shot]::GetDpiForWindow($hwnd) / 96
    [void][Shot]::MoveWindow($hwnd, 80, 60, [int]($w * $k), [int]($h * $k), $true)
    return $hwnd
}

$env:EASYPASS_HOME = $AppHome
# one instance per user: a copy that is still running would take this launch over and keep its own vault
Start-Process -FilePath $Exe -ArgumentList '--quit' -Wait
$p = Start-Process -FilePath $Exe -PassThru
try {
    $main = Wait-For { foreach ($w in (Windows-Of $p.Id)) { if (Find-Id $w 'SearchBox') { $w; break } } } 'main window'
    $hwnd = Set-Size $main 1120 720
    (Find-Id $main 'SearchBox').GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($Search)
    $item = Wait-For {
        $list = Find-Id $main 'EntryList'
        $items = $list.FindAll('Children', (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::ListItem)))
        if ($items.Count -eq 1) { $items[0] }
    } "one client for '$Search'"
    $item.GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select()
    Start-Sleep -Milliseconds 500
    # back to the whole list: the selected client stays selected
    (Find-Id $main 'SearchBox').GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue('')
    Start-Sleep -Milliseconds 800
    [Shot]::Save($hwnd, (Join-Path $Out ($Prefix + 'app.png')))
    Write-Host "wrote $($Prefix)app.png"

    # the button has no AutomationId: find it by its label in any of the three languages
    $labels = @('Settings', 'Ayarlar', [regex]::Unescape('\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438'))
    $settingsButton = $main.FindAll('Descendants', (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::Button))) |
        Where-Object { $labels -contains $_.Current.Name } | Select-Object -First 1
    $settingsButton.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke()
    $settings = Wait-For { $main.FindFirst('Children', (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::Window))) } 'settings window'
    Start-Sleep -Milliseconds 800
    [Shot]::Save([IntPtr]$settings.Current.NativeWindowHandle, (Join-Path $Out ($Prefix + 'settings.png')))
    Write-Host "wrote $($Prefix)settings.png"
    $settings.GetCurrentPattern([Windows.Automation.WindowPattern]::Pattern).Close()

    # the work tabs, by position (the Notifications header carries a count badge); a full list for the to-do tab
    $tabItems = (Find-Id $main 'Tabs').FindAll('Children', (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, [Windows.Automation.ControlType]::TabItem)))
    foreach ($tab in @(@(1, 'todo'), @(2, 'notifications'), @(3, 'tasks'))) {
        $tabItems[$tab[0]].GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select()
        Start-Sleep -Milliseconds 800
        [Shot]::Save($hwnd, (Join-Path $Out ($Prefix + $tab[1] + '.png')))
        Write-Host "wrote $($Prefix)$($tab[1]).png"
    }
    # the reminder window: a small window of the same process (the demo vault has a reminder that is already due)
    $reminder = Wait-For { foreach ($w in (Windows-Of $p.Id)) { if ($w.Current.NativeWindowHandle -ne $hwnd -and $w.Current.BoundingRectangle.Width -lt 1200 -and -not (Find-Id $w 'SearchBox')) { $w; break } } } 'reminder window' 40
    Start-Sleep -Milliseconds 500
    [Shot]::Save([IntPtr]$reminder.Current.NativeWindowHandle, (Join-Path $Out ($Prefix + 'reminder.png')))
    Write-Host "wrote $($Prefix)reminder.png"
} finally {
    Start-Sleep -Milliseconds 300
    # closing the window only hides it in the tray; --quit ends the app
    if (-not $p.HasExited) {
        Start-Process -FilePath $Exe -ArgumentList '--quit' -Wait
        if (-not $p.WaitForExit(10000)) { Stop-Process -Id $p.Id -Force }
    }
}
