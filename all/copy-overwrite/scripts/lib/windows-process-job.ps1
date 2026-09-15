# This file is managed by Lisa and IS replaced on each `lisa` run.
# Do not edit directly — durable changes belong upstream in Lisa.
# Use the installed Windows PowerShell policy; never override execution policy.
$ErrorActionPreference = 'Stop'
$parent = $null
try {
    $config = $env:LISA_WINDOWS_PROCESS_JOB | ConvertFrom-Json
    Remove-Item Env:LISA_WINDOWS_PROCESS_JOB
    $parent = [Diagnostics.Process]::GetProcessById([int]$config.parentPid)
    $null = $parent.Handle
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-process-job.cs')
    # Compiler scratch belongs to this helper; the gate retains its original env.
    [Environment]::SetEnvironmentVariable('TEMP', $config.originalTemp)
    [Environment]::SetEnvironmentVariable('TMP', $config.originalTmp)
    [Environment]::CurrentDirectory = $config.cwd
    $code = [LisaWindowsProcessJob]::Run($config.command, $config.directory, $parent)
    # Only a completed native membership wait may authorize a successful reap.
    [IO.File]::WriteAllText((Join-Path $config.directory 'reaped'), 'reaped')
    exit $code
} catch {
    [Console]::Error.WriteLine('Windows gate containment failed: ' + $_.Exception.Message)
    exit 1
} finally {
    if ($null -ne $parent) { $parent.Dispose() }
}
