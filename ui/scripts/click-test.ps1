# ចុចកន្លែងមួយក្នុង window របស់ app រួចថតរូបមុន/ក្រោយ — ដើម្បីដឹងថាការចុចដំណើរការឬទេ.
#   powershell -File scripts/click-test.ps1 -X 700 -Y 676 -Out C:\...\click
param([int]$X = 700, [int]$Y = 676, [string]$Out = "click")

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class U {
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

function Shot($handle, $path) {
  $r = New-Object U+RECT
  [void][U]::GetWindowRect($handle, [ref]$r)
  $bitmap = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $dc = $g.GetHdc(); [void][U]::PrintWindow($handle, $dc, 2); $g.ReleaseHdc($dc)
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  return $r
}

$app = Get-Process -Name app -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $app) { "no app window"; exit 1 }
$handle = $app.MainWindowHandle
$rect = Shot $handle "$Out-before.png"

[U]::SwitchToThisWindow($handle, $true)
Start-Sleep -Milliseconds 700
[void][U]::SetCursorPos(($rect.L + $X), ($rect.T + $Y))
Start-Sleep -Milliseconds 200
[U]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)   # left down
Start-Sleep -Milliseconds 80
[U]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)   # left up
Start-Sleep -Milliseconds 1200
[void](Shot $handle "$Out-after.png")
"clicked at window ($X,$Y) = screen ($($rect.L + $X),$($rect.T + $Y)); shots saved"
