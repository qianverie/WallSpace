param(
  [ValidateSet('desktop', 'measure', 'compose', 'batch', 'status', 'monitors', 'lock', 'probe', 'worker')]
  [string]$Action = 'status',
  [string]$Image = '',
  [string]$PlanFile = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Node exchanges UTF-8 JSON receipts over stdin/stdout. Keep monitor wallpaper
# paths intact even when the Windows console uses a different code page.
$utf8NoBom = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
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

  function Read-Plan([string]$file) {
    return ([IO.File]::ReadAllText($file) | ConvertFrom-Json)
  }

  function Wait-WinRt($operation, [type]$resultType) {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    if (-not $script:winRtTaskMethods) {
      $script:winRtTaskMethods = @([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1
      })
    }
    if ($resultType) {
      $method = $script:winRtTaskMethods | Where-Object { $_.IsGenericMethodDefinition } | Select-Object -First 1
      $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
    } else {
      $method = $script:winRtTaskMethods | Where-Object { -not $_.IsGenericMethodDefinition } | Select-Object -First 1
      $task = $method.Invoke($null, @($operation))
    }
    if (-not $task.Wait(12000)) { throw 'The Windows lock screen API timed out' }
    if ($resultType) { return $task.Result }
  }

  function Invoke-Action([string]$Act, [string]$Img, [string]$Plan) {
    try {
      switch ($Act) {
        'desktop' {
          return @{ ok = $true; desktop = (Get-Desktop) }
        }
        'measure' {
          $size = [DesktopMonitors]::Measure($Img)
          return @{ ok = $true; width = $size[0]; height = $size[1] }
        }
        'compose' {
          $planData = Read-Plan $Plan
          foreach ($job in $planData.jobs) {
            [DesktopMonitors]::Compose($job.source, $job.output, $job.width, $job.height,
              $job.x, $job.y, $job.imageWidth, $job.imageHeight, $job.tile, $job.color)
          }
          return @{ ok = $true }
        }
        'batch' {
          $planData = Read-Plan $Plan
          $before = Get-Desktop
          if (($before.flags -band 6) -ne 0) { throw 'Windows slideshow or remote-session wallpaper is active' }
          $changed = $before.position -ne $planData.before.position -or $before.color -ne $planData.before.color -or
            $before.monitors.Count -ne $planData.before.monitors.Count
          foreach ($expected in $planData.before.monitors) {
            $actual = $before.monitors | Where-Object { $_.id -eq $expected.id }
            if (-not $actual -or $actual.wallpaper -ne $expected.wallpaper -or $actual.x -ne $expected.x -or
                $actual.y -ne $expected.y -or $actual.width -ne $expected.width -or $actual.height -ne $expected.height) {
              $changed = $true
              break
            }
          }
          if ($changed) {
            return @{ ok = $false; code = 'DESKTOP_CHANGED'; error = 'Desktop settings changed before application' }
          }
          foreach ($change in $planData.changes) {
            if ($change.wallpaper -and -not (Test-Path -LiteralPath $change.wallpaper -PathType Leaf)) {
              throw 'Wallpaper file is no longer available'
            }
          }
          $attempted = @()
          try {
            if ($before.position -ne $planData.position) { [DesktopMonitors]::SetPosition($planData.position) }
            foreach ($change in $planData.changes) {
              $attempted += $change.id
              [DesktopMonitors]::Write($change.id, $change.wallpaper)
            }
            $after = Get-Desktop
            if ($after.position -ne $planData.position -or $after.monitors.Count -ne $before.monitors.Count) {
              throw 'Windows wallpaper position or display layout changed during application'
            }
            foreach ($monitor in $before.monitors) {
              $change = $planData.changes | Where-Object { $_.id -eq $monitor.id }
              $expectedPath = if ($change) { $change.wallpaper } else { $monitor.wallpaper }
              $actual = $after.monitors | Where-Object { $_.id -eq $monitor.id }
              if (-not $actual -or $actual.wallpaper -ne $expectedPath -or $actual.x -ne $monitor.x -or
                  $actual.y -ne $monitor.y -or $actual.width -ne $monitor.width -or $actual.height -ne $monitor.height) {
                throw 'Wallpaper verification failed'
              }
            }
            return @{ ok = $true; desktop = $after }
          } catch {
            $failure = $_.Exception.Message
            $rollback = $true
            foreach ($monitor in $before.monitors) {
              if ($monitor.id -notin $attempted) { continue }
              try { [DesktopMonitors]::Write($monitor.id, $monitor.wallpaper) } catch { $rollback = $false }
            }
            try { if ($before.position -ne $planData.position) { [DesktopMonitors]::SetPosition($before.position) } }
            catch { $rollback = $false }
            return @{ ok = $false; error = $failure; rollback = $rollback }
          }
        }
        'status' {
          return @{ ok = $true; action = 'status'; engine = 'powershell'; status = (Get-Status); monitors = (Get-Monitors) }
        }
        'monitors' {
          return @{ ok = $true; action = 'monitors'; monitors = (Get-Monitors) }
        }
        'probe' {
          $res = @{ ok = $false; action = 'probe'; engine = 'winrt'; winrt = $false; error = $null }
          try {
            [void][Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
            [void][Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime]
            $personalization = [Windows.System.UserProfile.UserProfilePersonalizationSettings,Windows.System.UserProfile,ContentType=WindowsRuntime]
            $res.winrt = $true
            $res.ok = $personalization::IsSupported()
            if (-not $res.ok) { $res.error = 'Windows personalization is unavailable' }
          } catch {
            $res.error = "$($_.Exception.Message)"
          }
          return $res
        }
        'lock' {
          if (-not $Img -or -not (Test-Path -LiteralPath $Img)) {
            return @{ ok = $false; action = 'lock'; error = "file not found: $Img" }
          }
          $full = (Resolve-Path -LiteralPath $Img).Path
          try {
            $storage = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
            [void][Windows.System.UserProfile.LockScreen,Windows.System.UserProfile,ContentType=WindowsRuntime]
            $sf = Wait-WinRt ($storage::GetFileFromPathAsync($full)) $storage
            $setOp = [Windows.System.UserProfile.LockScreen]::SetImageFileAsync($sf)
            Wait-WinRt $setOp
            return @{ ok = $true; action = 'lock'; engine = 'winrt'; image = $full; error = $null }
          } catch {
            return @{
              ok = $false; action = 'lock'; engine = 'winrt'; image = $full
              error = "$($_.Exception.GetBaseException().Message)"
              hint = '锁屏个性化可能被组策略禁用，或当前会话不支持 WinRT'
            }
          }
        }
        default {
          return @{ ok = $false; action = $Act; error = "unknown action: $Act"; engine = 'powershell' }
        }
      }
    } catch {
      return @{ ok = $false; action = $Act; error = "$($_.Exception.Message)"; engine = 'powershell' }
    }
  }

  if ($Action -eq 'worker') {
    Emit @{ ready = $true }
    while ($null -ne ($line = [Console]::In.ReadLine())) {
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      $reqId = $null
      try {
        $req = $line | ConvertFrom-Json
        $reqId = $req.id
        if ($req.action -eq 'quit') {
          Emit @{ id = $reqId; ok = $true; action = 'quit' }
          break
        }
        $imgArg = if ($null -ne $req.image) { [string]$req.image } else { '' }
        $planArg = if ($null -ne $req.planFile) { [string]$req.planFile } else { '' }
        $res = Invoke-Action ([string]$req.action) $imgArg $planArg
        $res['id'] = $reqId
        Emit $res
      } catch {
        Emit @{ id = $reqId; ok = $false; error = "$($_.Exception.Message)"; engine = 'powershell' }
      }
    }
  } else {
    Emit (Invoke-Action $Action $Image $PlanFile)
  }
} catch {
  Emit @{ ok = $false; action = $Action; error = "$($_.Exception.Message)"; engine = 'powershell' }
}
