param(
  [ValidateSet('desktop', 'measure', 'compose', 'batch', 'status', 'monitors', 'lock', 'probe')]
  [string]$Action = 'status',
  [string]$Image = '',
  [string]$PlanFile = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Node reads the JSON receipt as UTF-8. Keep monitor wallpaper paths intact
# even when the Windows console uses a different code page.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5))
}

try {
  if (-not ('WspNative' -as [type])) {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class WspNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }
}

[ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDesktopWallpaper {
  [PreserveSig] int SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
  [PreserveSig] int GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, out IntPtr wallpaper);
  [PreserveSig] int GetMonitorDevicePathAt(uint monitorIndex, out IntPtr monitorID);
  [PreserveSig] int GetMonitorDevicePathCount(out uint count);
  [PreserveSig] int GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorID, out WspNative.RECT displayRect);
  [PreserveSig] int SetBackgroundColor(uint color);
  [PreserveSig] int GetBackgroundColor(out uint color);
  [PreserveSig] int SetPosition(int position);
  [PreserveSig] int GetPosition(out int position);
  [PreserveSig] int SetSlideshow(IntPtr items);
  [PreserveSig] int GetSlideshow(out IntPtr items);
  [PreserveSig] int SetSlideshowOptions(uint options, uint tick);
  [PreserveSig] int GetSlideshowOptions(out uint options, out uint tick);
  [PreserveSig] int AdvanceSlideshow([MarshalAs(UnmanagedType.LPWStr)] string monitorID, int direction);
  [PreserveSig] int GetStatus(out uint status);
  [PreserveSig] int Enable([MarshalAs(UnmanagedType.Bool)] bool enabled);
}

[ComImport, Guid("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD")]
public class DesktopWallpaperClass { }

public static class DesktopMonitors {
  public class Monitor {
    public uint Index;
    public string Id;
    public WspNative.RECT Bounds;
    public bool Active;
    public string Wallpaper;
  }

  public static Monitor[] Read(bool wallpapers) {
    var dw = (IDesktopWallpaper)new DesktopWallpaperClass();
    try {
      uint count;
      if (dw.GetMonitorDevicePathCount(out count) != 0) return new Monitor[0];
      var monitors = new System.Collections.Generic.List<Monitor>();
      for (uint index = 0; index < count; index++) {
        IntPtr pointer;
        if (dw.GetMonitorDevicePathAt(index, out pointer) != 0) continue;
        string id;
        try { id = Marshal.PtrToStringUni(pointer); }
        finally { Marshal.FreeCoTaskMem(pointer); }
        WspNative.RECT bounds;
        int result = dw.GetMonitorRECT(id, out bounds);
        var monitor = new Monitor {
          Index = index, Id = id, Bounds = bounds,
          Active = result == 0 && bounds.Right > bounds.Left && bounds.Bottom > bounds.Top
        };
        if (wallpapers && monitor.Active) monitor.Wallpaper = ReadPath(dw, id);
        monitors.Add(monitor);
      }
      return monitors.ToArray();
    } finally {
      Marshal.ReleaseComObject(dw);
    }
  }

  private static string ReadPath(IDesktopWallpaper dw, string id) {
    IntPtr pointer;
    Marshal.ThrowExceptionForHR(dw.GetWallpaper(id, out pointer));
    try { return Marshal.PtrToStringUni(pointer) ?? ""; }
    finally { Marshal.FreeCoTaskMem(pointer); }
  }

  public static int[] ReadOptions() {
    var dw = (IDesktopWallpaper)new DesktopWallpaperClass();
    try {
      int position;
      uint color, status;
      Marshal.ThrowExceptionForHR(dw.GetPosition(out position));
      Marshal.ThrowExceptionForHR(dw.GetBackgroundColor(out color));
      Marshal.ThrowExceptionForHR(dw.GetStatus(out status));
      return new[] { position, (int)color, (int)status };
    } finally { Marshal.ReleaseComObject(dw); }
  }

  public static void Write(string id, string path) {
    var dw = (IDesktopWallpaper)new DesktopWallpaperClass();
    try {
      Marshal.ThrowExceptionForHR(dw.SetWallpaper(id, path));
      if (!String.Equals(ReadPath(dw, id), path, StringComparison.OrdinalIgnoreCase))
        throw new InvalidOperationException("Windows wallpaper read-back did not match the requested file.");
    } finally { Marshal.ReleaseComObject(dw); }
  }

  public static void SetPosition(int position) {
    var dw = (IDesktopWallpaper)new DesktopWallpaperClass();
    try { Marshal.ThrowExceptionForHR(dw.SetPosition(position)); }
    finally { Marshal.ReleaseComObject(dw); }
  }

  public static int[] Measure(string source) {
    using (var image = Image.FromFile(source)) {
      var format = image.RawFormat.Guid;
      if (format != ImageFormat.Jpeg.Guid && format != ImageFormat.Png.Guid && format != ImageFormat.Bmp.Guid)
        throw new ArgumentException("Image requires conversion to PNG.");
      return new[] { image.Width, image.Height };
    }
  }

  public static void Compose(string source, string output, int width, int height,
      float x, float y, float imageWidth, float imageHeight, bool tile, int color) {
    using (var bitmap = new Bitmap(width, height, PixelFormat.Format24bppRgb))
    using (var graphics = Graphics.FromImage(bitmap)) {
      graphics.Clear(Color.FromArgb(color & 255, (color >> 8) & 255, (color >> 16) & 255));
      if (!String.IsNullOrEmpty(source)) {
        using (var image = Image.FromFile(source)) {
          graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
          using (var edges = new ImageAttributes()) {
            edges.SetWrapMode(WrapMode.TileFlipXY);
            if (tile) {
              using (var brush = new TextureBrush(image, WrapMode.Tile)) {
                brush.ScaleTransform(imageWidth / image.Width, imageHeight / image.Height);
                brush.TranslateTransform(x, y, MatrixOrder.Append);
                graphics.FillRectangle(brush, 0, 0, width, height);
              }
            } else {
              var destination = new[] { new PointF(x, y), new PointF(x + imageWidth, y), new PointF(x, y + imageHeight) };
              graphics.DrawImage(image, destination, new RectangleF(0, 0, image.Width, image.Height), GraphicsUnit.Pixel, edges);
            }
          }
        }
      }
      bitmap.Save(output, ImageFormat.Png);
    }
  }
}
'@
  }

  $desktopKey = 'HKCU:\Control Panel\Desktop'

  function Get-Status {
    $p = Get-ItemProperty -Path $desktopKey -ErrorAction SilentlyContinue
    $transcoded = Join-Path $env:APPDATA 'Microsoft\Windows\Themes\TranscodedWallpaper'
    $tc = $null
    if (Test-Path $transcoded) {
      $f = Get-Item $transcoded
      $tc = @{ bytes = $f.Length; modified = $f.LastWriteTime.ToString('o') }
    }
    $mons = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue)
    return @{
      wallpaperStyle = "$($p.WallpaperStyle)"
      tileWallpaper  = "$($p.TileWallpaper)"
      wallpaper      = "$($p.WallPaper)"
      monitors       = $mons.Count
      transcoded     = $tc
    }
  }

  function Get-Monitors([switch]$WithWallpaper) {
    $list = @()
    try {
      # PowerShell cannot cast the COM coclass to its interface directly.
      foreach ($monitor in [DesktopMonitors]::Read([bool]$WithWallpaper)) {
        $r = $monitor.Bounds
        $list += @{
          index = $monitor.Index; id = $monitor.Id; active = $monitor.Active
          x = $r.Left; y = $r.Top
          width = ($r.Right - $r.Left); height = ($r.Bottom - $r.Top)
        }
        if ($WithWallpaper) { $list[-1].wallpaper = $monitor.Wallpaper }
      }
    } catch { if ($WithWallpaper) { throw } }
    if ($WithWallpaper) { return ,$list }
    if ($list.Count -eq 0) {
      $mons = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue)
      for ($i = 0; $i -lt $mons.Count; $i++) {
        $list += @{ index = $i; id = "$($mons[$i].InstanceName)"; width = 0; height = 0 }
      }
    }
    return ,$list
  }

  function Get-Desktop {
    $options = [DesktopMonitors]::ReadOptions()
    $monitors = @((Get-Monitors -WithWallpaper) | Where-Object { $_.active } | Sort-Object id)
    if ($monitors.Count -eq 0) { throw 'No active wallpaper displays' }
    return @{ position = $options[0]; color = $options[1]; flags = $options[2]; monitors = $monitors }
  }

  function Read-Plan {
    return ([IO.File]::ReadAllText($PlanFile) | ConvertFrom-Json)
  }

  switch ($Action) {
    'desktop' {
      Emit @{ ok = $true; desktop = (Get-Desktop) }
      break
    }
    'measure' {
      $size = [DesktopMonitors]::Measure($Image)
      Emit @{ ok = $true; width = $size[0]; height = $size[1] }
      break
    }
    'compose' {
      $plan = Read-Plan
      foreach ($job in $plan.jobs) {
        [DesktopMonitors]::Compose($job.source, $job.output, $job.width, $job.height,
          $job.x, $job.y, $job.imageWidth, $job.imageHeight, $job.tile, $job.color)
      }
      Emit @{ ok = $true }
      break
    }
    'batch' {
      $plan = Read-Plan
      $before = Get-Desktop
      if (($before.flags -band 6) -ne 0) { throw 'Windows slideshow or remote-session wallpaper is active' }
      $changed = $before.position -ne $plan.before.position -or $before.color -ne $plan.before.color -or
        $before.monitors.Count -ne $plan.before.monitors.Count
      foreach ($expected in $plan.before.monitors) {
        $actual = $before.monitors | Where-Object { $_.id -eq $expected.id }
        if (-not $actual -or $actual.wallpaper -ne $expected.wallpaper -or $actual.x -ne $expected.x -or
            $actual.y -ne $expected.y -or $actual.width -ne $expected.width -or $actual.height -ne $expected.height) {
          $changed = $true
          break
        }
      }
      if ($changed) {
        Emit @{ ok = $false; code = 'DESKTOP_CHANGED'; error = 'Desktop settings changed before application' }
        break
      }
      foreach ($change in $plan.changes) {
        if ($change.wallpaper -and -not (Test-Path -LiteralPath $change.wallpaper -PathType Leaf)) {
          throw 'Wallpaper file is no longer available'
        }
      }
      $attempted = @()
      try {
        if ($before.position -ne $plan.position) { [DesktopMonitors]::SetPosition($plan.position) }
        foreach ($change in $plan.changes) {
          $attempted += $change.id
          [DesktopMonitors]::Write($change.id, $change.wallpaper)
        }
        $after = Get-Desktop
        if ($after.position -ne $plan.position -or $after.monitors.Count -ne $before.monitors.Count) {
          throw 'Windows wallpaper position or display layout changed during application'
        }
        foreach ($monitor in $before.monitors) {
          $change = $plan.changes | Where-Object { $_.id -eq $monitor.id }
          $expectedPath = if ($change) { $change.wallpaper } else { $monitor.wallpaper }
          $actual = $after.monitors | Where-Object { $_.id -eq $monitor.id }
          if (-not $actual -or $actual.wallpaper -ne $expectedPath -or $actual.x -ne $monitor.x -or
              $actual.y -ne $monitor.y -or $actual.width -ne $monitor.width -or $actual.height -ne $monitor.height) {
            throw 'Wallpaper verification failed'
          }
        }
        Emit @{ ok = $true; desktop = $after }
      } catch {
        $failure = $_.Exception.Message
        $rollback = $true
        foreach ($monitor in $before.monitors) {
          if ($monitor.id -notin $attempted) { continue }
          try { [DesktopMonitors]::Write($monitor.id, $monitor.wallpaper) } catch { $rollback = $false }
        }
        try { if ($before.position -ne $plan.position) { [DesktopMonitors]::SetPosition($before.position) } }
        catch { $rollback = $false }
        Emit @{ ok = $false; error = $failure; rollback = $rollback }
      }
      break
    }
    'status' {
      Emit @{ ok = $true; action = 'status'; engine = 'powershell'; status = (Get-Status); monitors = (Get-Monitors) }
      break
    }
    'monitors' {
      Emit @{ ok = $true; action = 'monitors'; monitors = (Get-Monitors) }
      break
    }
    'probe' {
      # Read-only capability check: can this session load the WinRT lock-screen APIs?
      # Nothing is written to the system here.
      $res = @{ ok = $false; action = 'probe'; engine = 'winrt'; winrt = $false; error = $null }
      try {
        [void][Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
        [void][Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime]
        $res.winrt = $true
        $res.ok = $true
      } catch {
        $res.error = "$($_.Exception.Message)"
      }
      Emit $res
      break
    }
    'lock' {
      if (-not $Image -or -not (Test-Path -LiteralPath $Image)) {
        Emit @{ ok = $false; action = 'lock'; error = "file not found: $Image" }; break
      }
      $full = (Resolve-Path -LiteralPath $Image).Path
      try {
        [void][Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
        [void][Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime]
        function Wait-WinRt($op, $seconds = 8) {
          $deadline = (Get-Date).AddSeconds($seconds)
          while ($op.Status -eq 0 -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 80 }
          if ($op.Status -ne 1) { throw "WinRT async status=$($op.Status)" }
          return $op.GetResults()
        }
        $sfOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync($full)
        $sf = Wait-WinRt $sfOp
        $setOp = [Windows.System.UserProfile.LockScreen]::SetImageFileAsync($sf)
        [void](Wait-WinRt $setOp)
        Emit @{ ok = $true; action = 'lock'; engine = 'winrt'; image = $full; error = $null }
      } catch {
        Emit @{
          ok = $false; action = 'lock'; engine = 'winrt'; image = $full
          error = "$($_.Exception.Message)"
          hint = '锁屏个性化可能被组策略禁用，或当前会话不支持 WinRT'
        }
      }
      break
    }
  }
} catch {
  Emit @{ ok = $false; action = $Action; error = "$($_.Exception.Message)"; engine = 'powershell' }
}
