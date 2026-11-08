# Corre un comando de PowerShell en un escritorio de Windows aparte e invisible: lo que
# abra ahí no aparece en pantalla ni le quita el foco a nadie. Al terminar, el escritorio
# desaparece. No cambia ninguna opción del sistema.
#
# Vigilante: el comando deja en $env:PKTRUTAS_PID_OCULTO el PID del Packet Tracer que él
# mismo abrió. Si ESE proceso, y sólo ese, llegara a tener una ventana en el escritorio de
# verdad, se cierra en el acto. Las demás ventanas de Packet Tracer no se tocan.
#
# Lo que NO aísla: el portapapeles es de toda la sesión, y una aplicación empaquetada (el
# Bloc de notas de Windows 11, el navegador) puede abrirse en el escritorio de verdad. Una
# prueba que corra aquí no debe copiar nada ni abrir archivos o enlaces.
param([string]$Comando, [int]$TiempoMax = 240)

$archivoPid = Join-Path $env:TEMP "pktrutas_oculto_$PID.pid"
$bitacora = Join-Path $env:TEMP "pktrutas_oculto_$PID.log"
$env:PKTRUTAS_PID_OCULTO = $archivoPid

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class EscritorioOculto {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern IntPtr CreateDesktopW(string nombre, IntPtr d, IntPtr m, int f, uint acceso, IntPtr sa);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseDesktop(IntPtr h);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcessW(string app, string cmd, IntPtr pa, IntPtr ta, bool her, uint f, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
    [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr h, uint ms);
    [DllImport("kernel32.dll")] public static extern bool TerminateProcess(IntPtr h, uint c);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
    // EnumWindows sólo recorre el escritorio de quien llama: éste, el de verdad.
    public static bool Asoma(uint pid) {
        bool hay = false;
        EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p);
            if (p == pid && IsWindowVisible(h)) { hay = true; return false; } return true; }, IntPtr.Zero);
        return hay;
    }
}
"@

function PidDeLaInstancia {
    $v = 0
    if ((Test-Path $archivoPid) -and [int]::TryParse((Get-Content $archivoPid -ErrorAction SilentlyContinue), [ref]$v)) { return $v }
    return 0
}

$nombre = "PktRutasOculto$PID"
$esc = [EscritorioOculto]::CreateDesktopW($nombre, [IntPtr]::Zero, [IntPtr]::Zero, 0, 0x10000000, [IntPtr]::Zero)
if ($esc -eq [IntPtr]::Zero) { throw "no se pudo crear el escritorio oculto" }

$interno = "& { $Comando } *> '$bitacora'"
$cod = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($interno))
$si = New-Object EscritorioOculto+STARTUPINFO
$si.cb = [Runtime.InteropServices.Marshal]::SizeOf($si)
$si.lpDesktop = "WinSta0\$nombre"
$info = New-Object EscritorioOculto+PROCESS_INFORMATION
$exe = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$linea = "powershell.exe -NoProfile -NonInteractive -EncodedCommand $cod"
# 0x08000000 = CREATE_NO_WINDOW
if (-not [EscritorioOculto]::CreateProcessW($exe, $linea, [IntPtr]::Zero, [IntPtr]::Zero, $false, 0x08000000, [IntPtr]::Zero, $env:TEMP, [ref]$si, [ref]$info)) {
    $codigo = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    [void][EscritorioOculto]::CloseDesktop($esc)
    throw "no se pudo lanzar el proceso oculto (error $codigo)"
}

$limite = (Get-Date).AddSeconds($TiempoMax)
$asomo = $false; $vencio = $false
while ($true) {
    if ([EscritorioOculto]::WaitForSingleObject($info.hProcess, 200) -eq 0) { break }
    $v = PidDeLaInstancia
    if ($v -gt 0 -and [EscritorioOculto]::Asoma([uint32]$v)) { $asomo = $true; break }
    if ((Get-Date) -gt $limite) { $vencio = $true; break }
}
if ($asomo -or $vencio) { [void][EscritorioOculto]::TerminateProcess($info.hProcess, 9) }
[void][EscritorioOculto]::WaitForSingleObject($info.hProcess, 3000)
$v = PidDeLaInstancia
if ($v -gt 0) { Stop-Process -Id $v -Force -ErrorAction SilentlyContinue }
[void][EscritorioOculto]::CloseHandle($info.hThread)
[void][EscritorioOculto]::CloseHandle($info.hProcess)
Start-Sleep -Milliseconds 500
[void][EscritorioOculto]::CloseDesktop($esc)

if (Test-Path $bitacora) { Get-Content $bitacora -Encoding UTF8; Remove-Item $bitacora -ErrorAction SilentlyContinue }
Remove-Item $archivoPid -ErrorAction SilentlyContinue
if ($asomo) { throw "la instancia oculta se asomo al escritorio real; ya la cerre" }
if ($vencio) { throw "se acabo el tiempo ($TiempoMax s)" }
