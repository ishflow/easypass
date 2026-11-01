# The Tasks tab's + flow on a real EasyPass.exe: + opens a box with a new + under it, Add saves, Esc and Enter work.
# AppHome must be a throwaway EASYPASS_HOME holding a Turkish vault with at least one task. Exits 1 on the first failure.
param(
    [Parameter(Mandatory)] [string] $AppHome,
    [Parameter(Mandatory)] [string] $Exe,
    [string] $Out = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class Shot {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    public static void Save(IntPtr h, string path) {
        RECT w;
        GetWindowRect(h, out w);
        using (var full = new Bitmap(w.Right - w.Left, w.Bottom - w.Top)) {
            using (var g = Graphics.FromImage(full)) { var dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc); }
            full.Save(path, System.Drawing.Imaging.ImageFormat.Png);
        }
    }
}
'@ -ReferencedAssemblies System.Drawing

$A = [Windows.Automation.AutomationElement]
$Types = [Windows.Automation.ControlType]
$AddName = [regex]::Unescape('+ \u0130\u015f ekle')
$Typed = [regex]::Unescape('Y\u0131ll\u0131k rapor')
function Wait-For([scriptblock] $What, [string] $Name) {
    $end = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $end) { $r = & $What; if ($r) { return $r }; Start-Sleep -Milliseconds 100 }
    throw "timeout: $Name"
}
function All($type) { @($script:list.FindAll('Descendants', (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, $type)))) }
function Boxes { @(All $Types::Edit) }
function Button-Named($name) { All $Types::Button | Where-Object { $_.Current.Name -eq $name } | Select-Object -First 1 }
function Press($el) { $el.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 500 }
function Check($ok, $what) { if (-not $ok) { throw "FAIL: $what" }; Write-Host "ok: $what" }
function Snap($name) { if ($Out) { [Shot]::Save($script:hwnd, (Join-Path $Out "$name.png")) } }
function Task-Shown($name) { @(All $Types::Text | Where-Object { $_.Current.Name -eq $name }).Count -gt 0 }

$env:EASYPASS_HOME = $AppHome
Start-Process -FilePath $Exe -ArgumentList '--quit' -Wait # one instance per user: a running copy would keep its own vault
$p = Start-Process -FilePath $Exe -PassThru
try {
    $main = Wait-For {
        $A::RootElement.FindAll('Children', (New-Object Windows.Automation.PropertyCondition($A::ProcessIdProperty, $p.Id))) |
            Where-Object { $_.FindFirst('Descendants', (New-Object Windows.Automation.PropertyCondition($A::AutomationIdProperty, 'Tabs'))) } | Select-Object -First 1
    } 'main window'
    $script:hwnd = [IntPtr]$main.Current.NativeWindowHandle
    $tabs = $main.FindFirst('Descendants', (New-Object Windows.Automation.PropertyCondition($A::AutomationIdProperty, 'Tabs')))
    $tabs.FindAll('Children', (New-Object Windows.Automation.PropertyCondition($A::ControlTypeProperty, $Types::TabItem)))[3].GetCurrentPattern([Windows.Automation.SelectionItemPattern]::Pattern).Select()
    $script:list = Wait-For { $main.FindFirst('Descendants', (New-Object Windows.Automation.PropertyCondition($A::AutomationIdProperty, 'TaskList'))) } 'task list'
    Start-Sleep -Milliseconds 600

    Check ((Boxes).Count -eq 0 -and (Button-Named $AddName)) 'start: + and no box'
    Snap '1-baslangic'

    Press (Button-Named $AddName)
    $first = (Boxes)[0]
    Check ((Boxes).Count -eq 1 -and $first.Current.HasKeyboardFocus) '+ opens a focused box'
    Check (-not (Button-Named 'Ekle').Current.IsEnabled) 'Add is off while the box is empty'
    Check (Button-Named $AddName) 'a new + sits under the box'
    Snap '2-kutu-acildi'

    Press (Button-Named $AddName)
    Check ((Boxes).Count -eq 1) '+ on an empty box opens no second box'

    $first.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($Typed)
    Start-Sleep -Milliseconds 300
    Check ((Button-Named 'Ekle').Current.IsEnabled) 'Add turns on with text'
    Snap '3-yazi-yazildi'

    Press (Button-Named $AddName)
    Check ((Boxes).Count -eq 2) '+ opens a second box under a filled one'
    Check ((Boxes)[0].GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value -eq $Typed) 'the first box keeps its text'
    Check ((Boxes)[1].Current.HasKeyboardFocus) 'the second box has the focus'
    [void][Shot]::SetForegroundWindow($script:hwnd)
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Start-Sleep -Milliseconds 500
    Check ((Boxes).Count -eq 1) 'Esc closes only its own box'

    Press (Button-Named 'Ekle')
    Check ((Boxes).Count -eq 0 -and (Task-Shown $Typed) -and (Button-Named $AddName)) 'Add saves the task, + stays under it'
    Snap '4-eklendi'

    Check ((Button-Named $AddName).Current.HasKeyboardFocus) 'focus returns to +'
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    Start-Sleep -Milliseconds 500
    Check ((Boxes).Count -eq 1) 'Enter on + opens the next box'
    [System.Windows.Forms.SendKeys]::SendWait('Bordro kontrol{ENTER}')
    Start-Sleep -Milliseconds 700
    Check ((Boxes).Count -eq 0 -and (Task-Shown 'Bordro kontrol')) 'Enter in the box saves'
} finally {
    if (-not $p.HasExited) {
        Start-Process -FilePath $Exe -ArgumentList '--quit' -Wait
        if (-not $p.WaitForExit(10000)) { Stop-Process -Id $p.Id -Force }
    }
}
