# ថតរូប window របស់ app desktop (Tauri) តាមឈ្មោះ process.
#   powershell -File scripts/window-shot.ps1 -ProcessName app -Out shot.png
#
# ប្រើ `PrintWindow` ជំនួស `CopyFromScreen` ព្រោះ Windows មិនឲ្យកម្មវិធីយក
# window ទៅមុខគេបានទេ — ការថតអេក្រង់នឹងទទួលបាន window ផ្សេងដែលនៅខាងលើ.
param([string]$ProcessName = "app", [string]$Out = "window.png")

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@

$process = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $process) { Write-Output "no window for process $ProcessName"; exit 1 }

$rect = New-Object Win+RECT
[void][Win]::GetWindowRect($process.MainWindowHandle, [ref]$rect)
$width = $rect.R - $rect.L
$height = $rect.B - $rect.T
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$dc = $graphics.GetHdc()
# flag 2 = PW_RENDERFULLCONTENT, ចាំបាច់សម្រាប់ WebView2
$ok = [Win]::PrintWindow($process.MainWindowHandle, $dc, 2)
$graphics.ReleaseHdc($dc)
$bitmap.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "saved $Out ($width x $height) from pid $($process.Id), PrintWindow=$ok"
