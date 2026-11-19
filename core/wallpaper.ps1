param(
  [ValidateSet('apply', 'status', 'monitors', 'lock', 'probe')]
  [string]$Action = 'status',
  [string]$Image = '',
  [ValidateSet('fill', 'stretch', 'fit', 'tile', 'center', 'span')]
  [string]$Style = 'fill',
  [int]$MonitorIndex = -1
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5))
}

try {
  if (-not ('WspNative' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WspNative {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);

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
}

[ComImport, Guid("C2CF3110-460E-4FC1-B9D0-8A1C0C9CC4BD")]
public class DesktopWallpaperClass { }
'@
  }

  $styles = @{
    fill    = @{ WallpaperStyle = '10'; TileWallpaper = '0' }
    stretch = @{ WallpaperStyle = '2';  TileWallpaper = '0' }
    fit     = @{ WallpaperStyle = '6';  TileWallpaper = '0' }
    tile    = @{ WallpaperStyle = '0';  TileWallpaper = '1' }
    center  = @{ WallpaperStyle = '0';  TileWallpaper = '0' }
    span    = @{ WallpaperStyle = '22'; TileWallpaper = '0' }
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

  function Get-Monitors {
    $list = @()
    try {
      $dw = [IDesktopWallpaper](New-Object -TypeName DesktopWallpaperClass)
      [uint32]$count = 0
      $hr = $dw.GetMonitorDevicePathCount([ref]$count)
      if ($hr -eq 0) {
        for ($i = 0; $i -lt $count; $i++) {
          [IntPtr]$ptr = [IntPtr]::Zero
          if ($dw.GetMonitorDevicePathAt([uint32]$i, [ref]$ptr) -eq 0) {
            $id = [Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)
            $r = [WspNative+RECT]::new()
            [void]$dw.GetMonitorRECT($id, [ref]$r)
            $list += @{
              index = $i; id = $id
              width = ($r.Right - $r.Left); height = ($r.Bottom - $r.Top)
            }
            [Runtime.InteropServices.Marshal]::FreeCoTaskMem($ptr)
          }
        }
      }
    } catch { }
    if ($list.Count -eq 0) {
      $mons = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams -ErrorAction SilentlyContinue)
      for ($i = 0; $i -lt $mons.Count; $i++) {
        $list += @{ index = $i; id = "$($mons[$i].InstanceName)"; width = 0; height = 0 }
      }
    }
    return ,$list
  }

  switch ($Action) {
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
    'apply' {
      if (-not $Image -or -not (Test-Path -LiteralPath $Image)) {
        Emit @{ ok = $false; action = 'apply'; error = "file not found: $Image" }; break
      }
      $full = (Resolve-Path -LiteralPath $Image).Path
      $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
      if ($ext -notin @('.jpg','.jpeg','.png','.bmp')) {
        Emit @{ ok = $false; action = 'apply'; error = "unsupported format $ext (expected jpg/png/bmp)" }; break
      }
      $s = $styles[$Style]
      Set-ItemProperty -Path $desktopKey -Name WallpaperStyle -Value $s.WallpaperStyle
      Set-ItemProperty -Path $desktopKey -Name TileWallpaper  -Value $s.TileWallpaper

      $perMonitor = $null
      if ($MonitorIndex -ge 0) {
        try {
          $dw = [IDesktopWallpaper](New-Object -TypeName DesktopWallpaperClass)
          [uint32]$count = 0
          if (($dw.GetMonitorDevicePathCount([ref]$count) -eq 0) -and ($MonitorIndex -lt $count)) {
            [IntPtr]$ptr = [IntPtr]::Zero
            if ($dw.GetMonitorDevicePathAt([uint32]$MonitorIndex, [ref]$ptr) -eq 0) {
              $mid = [Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)
              $hr = $dw.SetWallpaper($mid, $full)
              [Runtime.InteropServices.Marshal]::FreeCoTaskMem($ptr)
              $perMonitor = @{ ok = ($hr -eq 0); hresult = $hr; monitorIndex = $MonitorIndex; monitorId = $mid; method = 'IDesktopWallpaper' }
            }
          } else {
            $perMonitor = @{ ok = $false; method = 'IDesktopWallpaper'; error = 'monitor index out of range or COM unavailable' }
          }
        } catch {
          $perMonitor = @{ ok = $false; method = 'IDesktopWallpaper'; error = "$($_.Exception.Message)" }
        }
      }

      # SPI_SETDESKWALLPAPER = 0x0014 ; SPIF_UPDATEINIFILE | SPIF_SENDCHANGE = 0x03
      $okApi = [WspNative]::SystemParametersInfo(0x0014, 0, $full, 0x03)
      $winErr = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
      $attempts = 1
      if (-not $okApi) {
        # A cold shell (or a just-committed TranscodedWallpaper) can reject the
        # first call. One clean retry removes most first-apply failures.
        Start-Sleep -Milliseconds 320
        $okApi = [WspNative]::SystemParametersInfo(0x0014, 0, $full, 0x03)
        $winErr = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        $attempts = 2
      }
      $verify = Get-ItemProperty -Path $desktopKey
      $errText = $null
      if (-not $okApi) { $errText = "SystemParametersInfo returned false, Win32Error=$winErr" }
      Emit @{
        ok = [bool]$okApi; action = 'apply'; engine = 'powershell'
        image = $full; style = $Style
        applied = @{ wallpaperStyle = "$($verify.WallpaperStyle)"; tileWallpaper = "$($verify.TileWallpaper)"; wallpaper = "$($verify.WallPaper)" }
        apiResult = [bool]$okApi
        attempts = $attempts
        perMonitor = $perMonitor
        error = $errText
      }
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
