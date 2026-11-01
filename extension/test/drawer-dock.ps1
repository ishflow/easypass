# The edge drawer on a real EasyPass.exe, driven with the mouse: click opens and closes it, a drag sticks it to any edge,
# the place survives a restart, and the window behind the empty part still takes clicks. Needs a desktop session.
# AppHome: a throwaway EASYPASS_HOME. Exits 1 on the first failure.
param(
    [Parameter(Mandatory)] [string] $AppHome,
    [Parameter(Mandatory)] [string] $Exe,
    [string] $Out = ''
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Win {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, IntPtr e);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    // The drawer: the process's visible tool window (WS_EX_TOOLWINDOW)
    public static IntPtr Drawer(int processId) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) => {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (pid == processId && IsWindowVisible(h) && (GetWindowLong(h, -20) & 0x80) != 0) found = h;
            return true;
        }, IntPtr.Zero);
        return found;
    }
    public static bool Hits(IntPtr window, int x, int y) {
        POINT p; p.X = x; p.Y = y;
        return GetAncestor(WindowFromPoint(p), 2) == window;
    }
}
'@

[void][Win]::SetProcessDPIAware() # real pixels, or on a scaled display the screenshots cut off the right and the bottom
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
# the handle in an open window: past the room left for the spring's overshoot, in the middle of the handle (window units 12 and 18)
$k = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero).DpiX / 96
$openHandle = [int](21 * $k)
function Check($ok, $what) { if (-not $ok) { throw "FAIL: $what" }; Write-Host "ok: $what" }
function Rect { $r = New-Object Win+RECT; [void][Win]::GetWindowRect((Wait-Drawer), [ref]$r); $r }
function Wait-Drawer {
    $end = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $end) { $h = [Win]::Drawer($script:p.Id); if ($h -ne [IntPtr]::Zero) { return $h }; Start-Sleep -Milliseconds 100 }
    throw 'timeout: drawer window'
}
function Down { [Win]::mouse_event(2, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 60 }
function Up { [Win]::mouse_event(4, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 60 }
function Click($x, $y) { [void][Win]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 120; Down; Up; Start-Sleep -Milliseconds 400 }
function Drag($fromX, $fromY, $toX, $toY) {
    [void][Win]::SetCursorPos($fromX, $fromY); Start-Sleep -Milliseconds 120
    Down
    foreach ($i in 1..12) { [void][Win]::SetCursorPos($fromX + ($toX - $fromX) * $i / 12, $fromY + ($toY - $fromY) * $i / 12); Start-Sleep -Milliseconds 25 }
    Start-Sleep -Milliseconds 100
    Up
    Start-Sleep -Milliseconds 500
}
function Snap($name) {
    if (-not $Out) { return }
    $bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $bmp.Size)
    $g.Dispose(); $bmp.Save((Join-Path $Out "$name.png")); $bmp.Dispose()
}
# Screen frames around a press on the handle, for a look at the motion: frame-NNN.png and fps.txt in a folder
function Record($folder, $x, $y, $left, $top, $w, $h, $ms) {
    if (-not $Out) { return }
    $dir = Join-Path $Out $folder
    New-Item -ItemType Directory $dir -Force | Out-Null
    [void][Win]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 150
    $frames = New-Object System.Collections.ArrayList
    $clock = [Diagnostics.Stopwatch]::StartNew()
    Down; Up
    while ($clock.ElapsedMilliseconds -lt $ms) {
        $bmp = New-Object System.Drawing.Bitmap $w, $h
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($left, $top, 0, 0, $bmp.Size)
        $g.Dispose()
        [void]$frames.Add($bmp)
    }
    $fps = $frames.Count / ($clock.ElapsedMilliseconds / 1000)
    Set-Content (Join-Path $dir 'fps.txt') ([string]::Format([Globalization.CultureInfo]::InvariantCulture, '{0:0.0}', $fps))
    Write-Host "recorded $folder $($frames.Count) frames at $([int]$fps) fps"
    $i = 0
    foreach ($f in $frames) { $f.Save((Join-Path $dir ('frame-{0:d3}.png' -f $i))); $f.Dispose(); $i++ }
}
function Start-App {
    $script:p = Start-Process -FilePath $Exe -ArgumentList '--background' -PassThru
    [void](Wait-Drawer); Start-Sleep -Milliseconds 800
}
function Stop-App {
    Start-Process -FilePath $Exe -ArgumentList '--quit' -Wait
    if (-not $script:p.WaitForExit(10000)) { Stop-Process -Id $script:p.Id -Force }
}
function Spot { (Get-Content (Join-Path $AppHome 'settings.json') -Raw | ConvertFrom-Json).drawerSpot }

$env:EASYPASS_HOME = $AppHome
Start-Process -FilePath $Exe -ArgumentList '--quit' -Wait # one instance per user: a running copy would keep its own vault
Start-App
try {
    $midY = [int]($screen.Top + $screen.Height / 2)
    $h = Wait-Drawer
    $r = Rect
    Check ($r.Right -eq $screen.Right) 'first run: on the right wall'
    Check ([Win]::Hits($h, $screen.Right - 6, $midY)) 'the handle takes the mouse'
    Check (-not [Win]::Hits($h, $screen.Right - 120, $midY)) 'closed: the empty part lets clicks through'
    Snap 'a1-sag-kapali'

    $before = Rect
    Click ($screen.Right - 6) $midY
    Start-Sleep -Milliseconds 300
    $open = Rect
    # the handle moved with the panel; the window box only changes for the panel's new height, never slides
    Check ($open.Right -eq $screen.Right -and ($open.Right - $open.Left) -eq ($before.Right - $before.Left)) 'opening keeps the window against the wall at one width'
    Check ([Win]::Hits($h, $screen.Right - 120, $midY)) 'open: the panel takes the mouse'
    Snap 'a2-sag-acik'
    Click ($open.Left + $openHandle) $midY
    Start-Sleep -Milliseconds 300
    Check (-not [Win]::Hits($h, $screen.Right - 120, $midY)) 'the handle closes it'
    Click ($screen.Right - 6) $midY
    Start-Sleep -Milliseconds 300
    $again = Rect
    Check (($open.Bottom - $open.Top) -eq ($again.Bottom - $again.Top)) 'the first opening is as tall as the next ones'
    Click ($again.Left + $openHandle) $midY
    Start-Sleep -Milliseconds 300

    if ($Out) {
        $recW = [int](380 * $k); $recH = [int](620 * $k); $l = $screen.Right - $recW; $t = [int]($midY - $recH / 2)
        Record 'kayit-ac' ($screen.Right - 6) $midY $l $t $recW $recH 900
        Start-Sleep -Milliseconds 300
        $open = Rect
        Record 'kayit-kapa' ($open.Left + $openHandle) $midY $l $t $recW $recH 650
        Start-Sleep -Milliseconds 300
    }

    # quick double press: the second one turns the slide back, and it ends closed
    Click ($screen.Right - 6) $midY
    Click ($open.Left + $openHandle) $midY
    Start-Sleep -Milliseconds 300
    Check (-not [Win]::Hits($h, $screen.Right - 120, $midY)) 'open then close in a row ends closed'

    Drag ($screen.Right - 6) $midY ($screen.Left + 30) ($screen.Top + 300)
    $r = Rect
    Check ($r.Left -eq $screen.Left -and (Spot) -like 'Left,*') 'drag to the left: stuck on the left wall'
    Check ([Win]::Hits($h, $screen.Left + 6, $screen.Top + 300)) 'the handle is where it was dropped'
    Snap 'b1-sol-kapali'
    Click ($screen.Left + 6) ($screen.Top + 300)
    Start-Sleep -Milliseconds 300
    Snap 'b2-sol-acik'
    $open = Rect
    Click ($open.Right - $openHandle) ($screen.Top + 300)
    Start-Sleep -Milliseconds 300

    Drag ($screen.Left + 6) ($screen.Top + 300) ([int]($screen.Left + $screen.Width * 0.3)) ($screen.Top + 25)
    $r = Rect
    Check ($r.Top -eq $screen.Top -and (Spot) -like 'Top,*') 'drag to the top: stuck on the top wall'
    Snap 'c1-ust-kapali'
    $x = [int]($screen.Left + $screen.Width * 0.3)
    Click $x ($screen.Top + 6)
    Start-Sleep -Milliseconds 300
    Snap 'c2-ust-acik'
    $open = Rect
    Click $x ($open.Bottom - $openHandle)
    Start-Sleep -Milliseconds 300

    Drag $x ($screen.Top + 6) ([int]($screen.Left + $screen.Width * 0.7)) ($screen.Bottom - 25)
    $r = Rect
    Check ($r.Bottom -eq $screen.Bottom -and (Spot) -like 'Bottom,*') 'drag to the bottom: stuck on the bottom wall'
    Snap 'd1-alt-kapali'
    $x = [int]($screen.Left + $screen.Width * 0.7)
    Click $x ($screen.Bottom - 6)
    Start-Sleep -Milliseconds 300
    Snap 'd2-alt-acik'

    # dragged while open: it travels closed and opens again at the new place
    $open = Rect
    Drag $x ($open.Top + $openHandle) ($screen.Right - 20) ($screen.Top + 200)
    $r = Rect
    Check ($r.Right -eq $screen.Right -and (Spot) -like 'Right,*') 'drag while open: stuck on the right wall'
    Check ([Win]::Hits($h, $screen.Right - 120, $screen.Top + 200)) 'and open again'
    $open = Rect
    Click ($open.Left + $openHandle) ($screen.Top + 200)
    Start-Sleep -Milliseconds 300

    Stop-App
    Start-App
    $h = Wait-Drawer
    Check ((Rect).Right -eq $screen.Right -and [Win]::Hits($h, $screen.Right - 6, $screen.Top + 200)) 'the place survives a restart'
    Snap 'e-yeniden-acildi'
} finally {
    if (-not $script:p.HasExited) { Stop-App }
}
