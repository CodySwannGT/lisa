# Native probe: exercise the production job with genuinely absent std handles.
param([string]$NativeSource, [string]$ControlDirectory, [long]$AbsentHandle)
$ErrorActionPreference = 'Stop'
Add-Type -Path $NativeSource
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class LisaTestStandardHandles {
    [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll")] public static extern bool SetStdHandle(int kind, IntPtr handle);
}
'@
$original = @(-10, -11, -12 | ForEach-Object { [LisaTestStandardHandles]::GetStdHandle($_) })
$parent = [Diagnostics.Process]::GetCurrentProcess()
try {
    foreach ($kind in @(-10, -11, -12)) {
        if (-not [LisaTestStandardHandles]::SetStdHandle($kind, [IntPtr]$AbsentHandle)) {
            throw 'Unable to set absent standard handle'
        }
    }
    [Environment]::CurrentDirectory = $ControlDirectory
    # Persist command execution despite missing caller input/output handles.
    $code = [LisaWindowsProcessJob]::Run('echo output & echo error 1>&2 & echo launched>launch.txt & exit /b 17', $ControlDirectory, $parent)
    [IO.File]::WriteAllText((Join-Path $ControlDirectory 'result.txt'), [string]$code)
} finally {
    for ($i = 0; $i -lt 3; $i++) {
        $null = [LisaTestStandardHandles]::SetStdHandle((-10 - $i), $original[$i])
    }
    $parent.Dispose()
}
