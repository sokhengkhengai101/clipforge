# Drop file ពិតលើ window របស់ app — OLE DoDragDrop + CF_HDROP ដូច Windows Explorer ធ្វើ.
#   powershell -STA -File scripts/native-drop.ps1 -File "D:\videos\podcast.mp4"
# លទ្ធផល effect=Copy = Tauri ទទួល drop; effect=None = បដិសេធ. វាយក mouse ~2 វិនាទី.
# ហេតុអ្វីត្រូវការវា: ការបញ្ជូន event 'tauri://drag-drop' តាម JS សាកតែពាក់កណ្ដាល —
# វាមិនប្រាប់ថា Windows ពិតជាផ្ញើ drop មក window ឬអត់. drop មិនដែលបានវាស់ពីមុន ព្រោះគ្មានឧបករណ៍នេះ.
param([string]$File = 'D:\Projects\clipforge\samples\Taylor_Tomlinson.mp4')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing @"
using System;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;
using System.Runtime.InteropServices;

public static class Dnd {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern void SwitchToThisWindow(IntPtr h, bool alt);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }

  public static string Run(IntPtr app, string file) {
    SwitchToThisWindow(app, true);
    Thread.Sleep(600);
    RECT r; GetWindowRect(app, out r);
    int toX = r.L + (r.R - r.L) * 60 / 100, toY = r.T + (r.B - r.T) * 30 / 100;

    // form តូចពណ៌ស្វាយលើជ្រុងខាងក្រោម-ឆ្វេង — កន្លែងដែលយើងចុច mouse ដោយសុវត្ថិភាព
    var form = new Form {
      FormBorderStyle = FormBorderStyle.None, TopMost = true, ShowInTaskbar = false,
      StartPosition = FormStartPosition.Manual, Size = new Size(60, 60),
      Location = new Point(r.L + 30, r.B - 120), BackColor = Color.Magenta
    };
    form.Show(); Application.DoEvents();
    int fromX = form.Left + 30, fromY = form.Top + 30;
    SetCursorPos(fromX, fromY); Thread.Sleep(150);

    var mover = new Thread(() => {
      Thread.Sleep(300);
      for (int i = 1; i <= 25; i++) {
        SetCursorPos(fromX + (toX - fromX) * i / 25, fromY + (toY - fromY) * i / 25);
        Thread.Sleep(30);
      }
      Thread.Sleep(500);                                   // ឲ្យ target ទទួល DragOver
      mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);           // left up = drop
    });

    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);             // left down លើ form យើង
    Application.DoEvents();
    mover.Start();
    var data = new DataObject(DataFormats.FileDrop, new string[] { file });
    DragDropEffects effect = form.DoDragDrop(data, DragDropEffects.Copy);
    mover.Join();
    form.Close();
    return string.Format("effect={0}  from=({1},{2}) to=({3},{4})", effect, fromX, fromY, toX, toY);
  }
}
"@

[void][Dnd]::SetProcessDPIAware()
$app = Get-Process -Name app -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $app) { 'no app window'; exit 1 }
"file exists: " + (Test-Path -LiteralPath $File) + "  ($File)"
[Dnd]::Run($app.MainWindowHandle, $File)
