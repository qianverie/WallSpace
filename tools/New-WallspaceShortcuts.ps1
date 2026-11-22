$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'runtime'
$electron = Join-Path $runtime 'electron.exe'
$launcher = Join-Path $runtime 'WallspaceLauncher.exe'
$source = Join-Path $PSScriptRoot 'WallspaceLauncher.cs'
$icon = Join-Path $root 'assets\wallscape.ico'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$appId = 'Wallspace.Desktop'

foreach ($file in @($electron, $source, $icon, $compiler)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file is missing: $file" }
}

if (-not ('WallspaceShortcut' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public static class WallspaceShortcut
{
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink { }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey { public Guid Format; public uint Id; }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropVariant
    {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Pointer;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        uint GetCount();
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant variant);

    public static string AppId(string file, string id)
    {
        var link = new ShellLink();
        var persist = (IPersistFile)link;
        var store = (IPropertyStore)link;
        var key = new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = 5 };
        PropVariant value = new PropVariant();
        try
        {
            persist.Load(file, String.IsNullOrEmpty(id) ? 0 : 2);
            if (String.IsNullOrEmpty(id))
            {
                store.GetValue(ref key, out value);
                return value.Type == 31 ? Marshal.PtrToStringUni(value.Pointer) : null;
            }
            value = new PropVariant { Type = 31, Pointer = Marshal.StringToCoTaskMemUni(id) };
            store.SetValue(ref key, ref value);
            store.Commit();
            persist.Save(file, true);
            return id;
        }
        finally
        {
            PropVariantClear(ref value);
            Marshal.FinalReleaseComObject(link);
        }
    }
}
'@
}

$shell = New-Object -ComObject WScript.Shell
$shortcuts = @(
    (Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Wallspace.lnk'),
    (Join-Path ([Environment]::GetFolderPath('Programs')) 'Wallspace.lnk')
)
foreach ($file in $shortcuts) {
    if ((Test-Path -LiteralPath $file) -and $shell.CreateShortcut($file).TargetPath -notin @($electron, $launcher)) {
        throw "Another shortcut already uses this name: $file"
    }
}

$temporary = Join-Path $runtime ('WallspaceLauncher-' + [Guid]::NewGuid().ToString('N') + '.exe')
try {
    & $compiler /nologo /target:winexe /reference:System.Windows.Forms.dll "/win32icon:$icon" "/out:$temporary" $source
    if ($LASTEXITCODE -ne 0) { throw 'Could not build the Wallspace launcher' }
    Move-Item -LiteralPath $temporary -Destination $launcher -Force
} finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
}

foreach ($file in $shortcuts) {
    $shortcut = $shell.CreateShortcut($file)
    $shortcut.TargetPath = $launcher
    $shortcut.Arguments = ''
    $shortcut.WorkingDirectory = $root
    $shortcut.IconLocation = "$icon,0"
    $shortcut.Description = 'Wallspace'
    $shortcut.Save()
    [void][WallspaceShortcut]::AppId($file, $appId)
    if ([WallspaceShortcut]::AppId($file, $null) -ne $appId) { throw "Could not verify the shortcut: $file" }
    Write-Output $file
}
