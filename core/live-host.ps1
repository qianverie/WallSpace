param(
  [Parameter(Mandatory=$true)][long]$Window,
  [Parameter(Mandatory=$true)][int]$Owner,
  [int]$X, [int]$Y, [int]$Width, [int]$Height
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WallscapeDesktopLayer {
  [StructLayout(LayoutKind.Sequential)]
  private struct Point { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)]
  private struct Rect { public int Left, Top, Right, Bottom; }
  private delegate bool EnumProc(IntPtr window, IntPtr parameter);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr window);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int process);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr window, ref Point point);
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern IntPtr Style(IntPtr window, int index);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW", SetLastError = true)]
  private static extern IntPtr SetStyle(IntPtr window, int index, IntPtr style);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetParent(IntPtr window, IntPtr parent);
  [DllImport("user32.dll", SetLastError = true)] private static extern bool SetLayeredWindowAttributes(IntPtr window, uint color, byte alpha, uint flags);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int w, int h, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr w, IntPtr l, uint flags, uint wait, out IntPtr result);
  [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect rect, int size);
  [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")]
  private static extern int DwmGetWindowInteger(IntPtr window, int attribute, out int value, int size);

  public static bool Owned(IntPtr window, int owner) {
    int process;
    return IsWindow(window) && GetWindowThreadProcessId(window, out process) != 0 && process == owner;
  }

  public static IntPtr Shell() { return FindWindow("Progman", null); }
  public static void UsePhysicalPixels() { SetThreadDpiAwarenessContext(new IntPtr(-4)); }

  public static IntPtr Attach(IntPtr window, int owner, IntPtr shell, int x, int y, int w, int h) {
    if (!Owned(window, owner) || shell == IntPtr.Zero || w <= 0 || h <= 0)
      throw new InvalidOperationException("Desktop or wallpaper window unavailable.");

    bool layered = (Style(shell, -20).ToInt64() & 0x00200000) != 0;
    IntPtr iconLayer = FindWindowEx(shell, IntPtr.Zero, "SHELLDLL_DefView", null);
    IntPtr worker = FindWindowEx(shell, IntPtr.Zero, "WorkerW", null);
    if (!layered || worker == IntPtr.Zero || iconLayer == IntPtr.Zero) {
      IntPtr result;
      SendMessageTimeout(shell, 0x052C, new IntPtr(13), new IntPtr(1), 2, 1200, out result);
      iconLayer = FindWindowEx(shell, IntPtr.Zero, "SHELLDLL_DefView", null);
    }

    IntPtr parent = shell;
    IntPtr below = iconLayer;
    if (!layered) {
      parent = IntPtr.Zero;
      EnumWindows((top, ignored) => {
        if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) == IntPtr.Zero) return true;
        parent = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
        return parent == IntPtr.Zero;
      }, IntPtr.Zero);
      below = IntPtr.Zero;
    }
    if (parent == IntPtr.Zero || (layered && below == IntPtr.Zero))
      throw new InvalidOperationException("Windows desktop icon layer unavailable.");

    long style = Style(window, -16).ToInt64();
    SetStyle(window, -16, new IntPtr((style & ~0x80000000L) | 0x40000000L));
    long extended = Style(window, -20).ToInt64();
    extended = (extended & ~0x00040000L) | 0x08000080L; // no activate, tool window
    if (layered) extended |= 0x00080000L;
    SetStyle(window, -20, new IntPtr(extended));
    SetParent(window, parent);
    if (GetParent(window) != parent) throw new InvalidOperationException("Could not attach wallpaper behind desktop icons.");
    if (layered && !SetLayeredWindowAttributes(window, 0, 255, 2))
      throw new InvalidOperationException("Windows could not enable the wallpaper surface.");
    var origin = new Point { X = x, Y = y };
    if (!ScreenToClient(parent, ref origin) || !SetWindowPos(window, below, origin.X, origin.Y, w, h, 0x70))
      throw new InvalidOperationException("Could not place wallpaper on the selected monitor.");
    return parent;
  }

  public static bool Covered(IntPtr wallpaper, int x, int y, int w, int h) {
    bool covered = false;
    EnumWindows((window, ignored) => {
      Rect rect;
      if (window == wallpaper || !IsWindowVisible(window) || IsIconic(window) ||
          !GetWindowRect(window, out rect) || !Fills(rect, x, y, w, h)) return true;
      var name = new StringBuilder(128);
      GetClassName(window, name, name.Capacity);
      switch (name.ToString()) {
        case "Progman": case "WorkerW": case "Shell_TrayWnd": case "Shell_SecondaryTrayWnd": return true;
      }
      int cloaked;
      if (DwmGetWindowInteger(window, 14, out cloaked, sizeof(int)) == 0 && cloaked != 0) return true;
      Rect visible;
      if (DwmGetWindowAttribute(window, 9, out visible, Marshal.SizeOf(typeof(Rect))) == 0 &&
          !Fills(visible, x, y, w, h)) return true;
      covered = true;
      return false;
    }, IntPtr.Zero);
    return covered;
  }

  private static bool Fills(Rect rect, int x, int y, int w, int h) {
    return rect.Left <= x + 2 && rect.Top <= y + 2 && rect.Right >= x + w - 2 && rect.Bottom >= y + h - 2;
  }
}
'@

  [WallscapeDesktopLayer]::UsePhysicalPixels()
  $handle = [IntPtr]$Window
  $parent = [IntPtr]::Zero
  $lastShell = [IntPtr]::Zero
  $paused = $null
  while ([WallscapeDesktopLayer]::Owned($handle, $Owner)) {
    $shell = [WallscapeDesktopLayer]::Shell()
    if ($shell -ne [IntPtr]::Zero -and
        ($shell -ne $lastShell -or $parent -eq [IntPtr]::Zero -or [WallscapeDesktopLayer]::GetParent($handle) -ne $parent)) {
      $parent = [WallscapeDesktopLayer]::Attach($handle, $Owner, $shell, $X, $Y, $Width, $Height)
      $lastShell = $shell
      [Console]::WriteLine((@{ state = 'attached'; parent = $parent.ToInt64() } | ConvertTo-Json -Compress))
    }
    $covered = [WallscapeDesktopLayer]::Covered($handle, $X, $Y, $Width, $Height)
    if ($null -eq $paused -or $covered -ne $paused) {
      $paused = $covered
      [Console]::WriteLine((@{ state = 'playback'; paused = $paused } | ConvertTo-Json -Compress))
    }
    Start-Sleep -Milliseconds 650
  }
} catch {
  [Console]::WriteLine((@{ state = 'failed'; error = $_.Exception.Message } | ConvertTo-Json -Compress))
  exit 1
}
