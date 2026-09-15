// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
// Windows 10 / Server 2016 or newer: create the shell inside its Job Object.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

/// <summary>Runs a shell inside a retained job and confirms its descendants have exited.</summary>
public static class LisaWindowsProcessJob
{
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint Priority, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits
    {
        public BasicLimits Basic;
        public ulong ReadOperations, WriteOperations, OtherOperations;
        public ulong ReadBytes, WriteBytes, OtherBytes;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Accounting
    {
        public long UserTime, KernelTime, PeriodUserTime, PeriodKernelTime;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct StartupInfo
    {
        public uint Size;
        public IntPtr Reserved, Desktop, Title;
        public uint X, Y, Width, Height, XCount, YCount, Fill, Flags;
        public ushort ShowWindow, ReservedLength;
        public IntPtr ReservedData, Input, Output, Error;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct StartupInfoEx
    {
        public StartupInfo Startup;
        public IntPtr Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInformation
    {
        public IntPtr Process, Thread;
        public uint ProcessId, ThreadId;
    }

    /// <summary>Creates the helper-owned job handle, which is never inherited by the shell.</summary>
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    /// <summary>Applies the job limits used to kill members when its final handle closes.</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits value, uint size);
    /// <summary>Reads job accounting so cleanup can confirm zero active processes.</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting value, uint size, IntPtr returned);
    /// <summary>Requests termination of every process retained in the job.</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr job, uint code);
    /// <summary>Measures or initializes storage for the two process-creation attributes.</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    /// <summary>Adds the job binding or restricted inherited-handle list before process creation.</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    /// <summary>Releases initialized attribute-list contents before their backing memory is freed.</summary>
    [DllImport("kernel32.dll")]
    static extern void DeleteProcThreadAttributeList(IntPtr list);
    /// <summary>Creates the shell with job membership and explicit standard handles already assigned.</summary>
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation process);
    /// <summary>Polls the shell handle while allowing stop-file and owner-exit checks.</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    /// <summary>Reads the shell exit code after its process handle signals completion.</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    /// <summary>Releases an owned native handle without closing borrowed caller handles.</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
    /// <summary>Supplies the current-process pseudo handle for standard-handle duplication.</summary>
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();
    /// <summary>Reads a borrowed standard handle, which may be absent in a service process.</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int kind);
    /// <summary>Opens a temporary NUL device handle when a standard stream is absent.</summary>
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr attributes, uint creation, uint flags, IntPtr template);
    /// <summary>Creates an inheritable duplicate while retaining ownership of the original handle.</summary>
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);

    /// <summary>Throws with the captured native error when an operation reports failure.</summary>
    static void Check(bool ok, string operation)
    {
        if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
    }

    /// <summary>Returns an owned inheritable standard handle, substituting NUL only when absent.</summary>
    /// <param name="kind">The native standard-input, output, or error handle identifier.</param>
    /// <returns>A duplicate that Run must close after the contained command finishes.</returns>
    static IntPtr StandardHandle(int kind)
    {
        IntPtr source = GetStdHandle(kind);
        bool absent = source == IntPtr.Zero || source == new IntPtr(-1);
        if (absent)
        {
            // Services may have no standard handles. Supply EOF/discard devices
            // while preserving any real redirected handles supplied by callers.
            source = CreateFileW("NUL", kind == -10 ? 0x80000000u : 0x40000000u, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
            Check(source != new IntPtr(-1), "Open absent gate standard handle");
        }
        try
        {
            IntPtr result;
            Check(DuplicateHandle(GetCurrentProcess(), source, GetCurrentProcess(), out result, 0, true, 2), "Duplicate gate standard handle");
            return result;
        }
        finally
        {
            if (absent) CloseHandle(source);
        }
    }

    /// <summary>Terminates job members and waits up to five seconds for empty membership.</summary>
    /// <param name="job">The retained job handle; this method does not close it.</param>
    static void TerminateAndWait(IntPtr job)
    {
        Check(TerminateJobObject(job, 255), "Terminate gate job");
        Stopwatch deadline = Stopwatch.StartNew();
        for (;;)
        {
            Accounting state;
            Check(QueryInformationJobObject(job, 1, out state, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero), "Read gate job membership");
            if (state.ActiveProcesses == 0) return;
            if (deadline.ElapsedMilliseconds >= 5000) throw new TimeoutException("Gate job still has processes after termination");
            Thread.Sleep(25);
        }
    }

    /// <summary>Runs a contained command and reaps its descendants before returning.</summary>
    /// <remarks>
    /// The helper owns the job outside its membership. A helper crash closes
    /// its non-inherited job handle and kills the job as a backstop.
    /// </remarks>
    /// <param name="command">The shell command, forwarded without rewriting its arguments.</param>
    /// <param name="controlDirectory">The caller-owned directory containing the stop marker.</param>
    /// <param name="parent">The retained owner process whose exit requests cancellation.</param>
    /// <returns>The shell exit code, or 255 when interrupted before normal completion.</returns>
    public static int Run(string command, string controlDirectory, Process parent)
    {
        IntPtr job = IntPtr.Zero, attributes = IntPtr.Zero;
        IntPtr jobValue = IntPtr.Zero, handleValues = IntPtr.Zero;
        bool attributesInitialized = false;
        IntPtr[] standard = new IntPtr[3];
        ProcessInformation child = new ProcessInformation();
        uint result = 255;
        try
        {
            job = CreateJobObjectW(IntPtr.Zero, null);
            Check(job != IntPtr.Zero, "Create gate job");
            ExtendedLimits limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
            Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))), "Set gate job lifetime");

            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            Check(size != IntPtr.Zero, "Measure gate process attributes");
            attributes = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(attributes, 2, 0, ref size), "Initialize gate process attributes");
            attributesInitialized = true;
            jobValue = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobValue, job);
            // PROC_THREAD_ATTRIBUTE_JOB_LIST binds before the first instruction;
            // suspended-create followed by assignment has an orphaning window.
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x2000D), jobValue, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "Bind gate to job at creation");

            handleValues = Marshal.AllocHGlobal(3 * IntPtr.Size);
            for (int i = 0; i < 3; ++i)
            {
                standard[i] = StandardHandle(-10 - i);
                Marshal.WriteIntPtr(handleValues, i * IntPtr.Size, standard[i]);
            }
            Check(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handleValues, new IntPtr(3 * IntPtr.Size), IntPtr.Zero, IntPtr.Zero), "Limit inherited gate handles");
            StartupInfoEx startup = new StartupInfoEx();
            startup.Startup.Size = (uint)Marshal.SizeOf(typeof(StartupInfoEx));
            startup.Startup.Flags = 0x100; // STARTF_USESTDHANDLES.
            startup.Startup.Input = standard[0];
            startup.Startup.Output = standard[1];
            startup.Startup.Error = standard[2];
            startup.Attributes = attributes;
            string shell = Environment.GetEnvironmentVariable("ComSpec") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe");
            StringBuilder line = new StringBuilder("\"" + shell + "\" /d /s /c \"" + command + "\"");
            // Never launch a command after a stop or owner exit during startup.
            if (File.Exists(Path.Combine(controlDirectory, "stop")) || parent.WaitForExit(0)) return 255;
            Check(CreateProcessW(shell, line, IntPtr.Zero, IntPtr.Zero, true, 0x80000, IntPtr.Zero, Environment.CurrentDirectory, ref startup, out child), "Create contained gate command");
            for (;;)
            {
                uint wait = WaitForSingleObject(child.Process, 25);
                if (wait == 0)
                {
                    Check(GetExitCodeProcess(child.Process, out result), "Read gate command exit");
                    break;
                }
                Check(wait == 258, "Wait for gate command");
                if (File.Exists(Path.Combine(controlDirectory, "stop")) || parent.WaitForExit(0)) break;
            }
        }
        finally
        {
            // Release our process handles before checking membership accounting.
            if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
            if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
            try
            {
                if (job != IntPtr.Zero) TerminateAndWait(job);
            }
            finally
            {
                if (job != IntPtr.Zero) CloseHandle(job);
                foreach (IntPtr handle in standard) if (handle != IntPtr.Zero) CloseHandle(handle);
                if (attributesInitialized) DeleteProcThreadAttributeList(attributes);
                if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
                if (jobValue != IntPtr.Zero) Marshal.FreeHGlobal(jobValue);
                if (handleValues != IntPtr.Zero) Marshal.FreeHGlobal(handleValues);
            }
        }
        return unchecked((int)result);
    }
}
