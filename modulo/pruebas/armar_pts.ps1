# Arma modulo\PktRutas.pts con el propio editor de Packet Tracer: el formato .pts
# está cifrado y sólo Packet Tracer lo escribe. Abre un Packet Tracer aparte, manejado con
# UI Automation, y lo cierra al terminar; no toca los que ya estén abiertos.
#
# Corre en un escritorio oculto (oculto.ps1), así que no se ve ni quita el foco. Con
# -Visible se abre en pantalla, para ver qué pasa si algo falla; -DejarAbierto lo deja ahí.
param([string]$Salida = "", [switch]$Visible, [switch]$DejarAbierto, [switch]$Adentro)

$M = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if ($Salida -eq "") { $Salida = Join-Path $M "PktRutas.pts" }
if (-not $Visible -and -not $Adentro) {
    $antes = if (Test-Path $Salida) { (Get-Item $Salida).LastWriteTimeUtc } else { $null }
    & (Join-Path $PSScriptRoot "oculto.ps1") -Comando "& '$PSCommandPath' -Adentro -Salida '$Salida'" -TiempoMax 180
    # Lo de adentro corre en otro proceso: la prueba de que funcionó es el archivo.
    $despues = if (Test-Path $Salida) { (Get-Item $Salida).LastWriteTimeUtc } else { $null }
    if ($null -eq $despues -or $despues -eq $antes) { throw "no se armo: $Salida sigue igual que antes" }
    return
}
$VERSION = "2.0.0"
$SCRIPTS = '"bytes.js" "ipv.js" "modelo.js" "plan.js" "enlaces.js" "rutas.js" "combos.js" "inalambrico.js" "comandos.js" "principal.js"'
$PERMISOS = @("Application", "File Operations", "Change User Interface", "Get Network Info", "Change Network Info", "Miscellaneous UI")

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win32Armar {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$TODOS = [System.Windows.Automation.Condition]::TrueCondition

function Tipo($e) { return ($e.Current.ControlType.ProgrammaticName -replace "ControlType\.", "") }
function Raices([int]$ProcId) {
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, $ProcId)
    return $AE::RootElement.FindAll($TS::Children, $cond)
}
function Ventana([int]$ProcId, [string]$Clase) {
    return (Raices $ProcId) | Where-Object { $_.Current.ClassName -eq $Clase } | Select-Object -First 1
}
function Buscar($raiz, [string]$nombre, [string]$tipo, [switch]$Visible) {
    foreach ($e in $raiz.FindAll($TS::Descendants, $TODOS)) {
        if ($e.Current.Name -eq $nombre -and (Tipo $e) -eq $tipo -and (-not $Visible -or -not $e.Current.IsOffscreen)) { return $e }
    }
    throw "no encontre [$tipo] '$nombre'"
}
function Invocar($e) { $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
function Desplegar($e) { $e.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand(); Start-Sleep -Milliseconds 500 }
function Pestana($w, [string]$n) {
    # Recién abierto, el editor todavía reacomoda sus pestañas: se reintenta.
    for ($i = 0; ; $i++) {
        try {
            (Buscar $w $n "TabItem").GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
            break
        } catch {
            if ($i -ge 5) { throw }
            Start-Sleep -Seconds 1
            $w = Ventana $p.Id "CScriptingInterface"
        }
    }
    Start-Sleep -Milliseconds 500
}
function Valor($w, [string]$nombre, [string]$texto) {
    (Buscar $w $nombre "Edit").GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($texto)
}
function DialogoArchivos($w) {
    for ($i = 0; $i -lt 40; $i++) {
        $d = $w.FindAll($TS::Children, $TODOS) | Where-Object { $_.Current.ClassName -eq "#32770" } | Select-Object -First 1
        if ($d) { return $d }
        Start-Sleep -Milliseconds 250
    }
    throw "no aparecio el dialogo de archivos"
}
function LlenarDialogo($dlg, [string]$texto) {
    $campo = $null; $boton = $null
    foreach ($e in $dlg.FindAll($TS::Descendants, $TODOS)) {
        if ($e.Current.ClassName -eq "Edit" -and $null -eq $campo) {
            $p = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($e)
            $a = if ($p) { [System.Windows.Automation.TreeWalker]::RawViewWalker.GetParent($p) } else { $null }
            # Al abrir cuelga de ComboBoxEx32; al guardar, de AppControlHost.
            if (($a -and $a.Current.ClassName -eq "ComboBoxEx32") -or ($p -and $p.Current.ClassName -eq "AppControlHost")) { $campo = $e }
        }
        if ($e.Current.ClassName -eq "Button" -and $e.Current.Name -match "^&?(Abrir|Guardar|Open|Save)") { $boton = $e }
    }
    if ($null -eq $campo -or $null -eq $boton) {
        foreach ($e in $dlg.FindAll($TS::Descendants, $TODOS)) {
            if ($e.Current.ClassName -in @("Edit", "Button", "ComboBox", "ComboBoxEx32")) {
                $w2 = [System.Windows.Automation.TreeWalker]::RawViewWalker
                $pa = $w2.GetParent($e); $ab = if ($pa) { $w2.GetParent($pa) } else { $null }
                "  [" + $e.Current.ClassName + "] '" + $e.Current.Name + "' padre=" + $pa.Current.ClassName + " abuelo=" + $ab.Current.ClassName
            }
        }
        throw "dialogo de archivos sin campo o sin boton"
    }
    [void][Win32Armar]::SendMessage([IntPtr]$campo.Current.NativeWindowHandle, 0x000C, [IntPtr]::Zero, $texto)
    [void][Win32Armar]::PostMessage([IntPtr]$boton.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
}

function AbrirDeScripting([string]$item) {
    $top = Ventana $p.Id "CAppWindow"
    Desplegar (Buscar $top "Extensions" "MenuItem")
    Desplegar (Buscar $top "Scripting" "MenuItem")
    Invocar (Buscar $top $item "MenuItem")
}

# Acepta los avisos que haya, y dice cuáles eran.
function ContestarAvisos {
    foreach ($r in (Raices $p.Id)) {
        foreach ($h in @($r) + @($r.FindAll($TS::Children, $TODOS))) {
            if ($h.Current.ClassName -ne "QMessageBox") { continue }
            foreach ($e in $h.FindAll($TS::Descendants, $TODOS)) {
                if ((Tipo $e) -eq "Button" -and $e.Current.Name -match "^(Yes|OK|Ok)$") {
                    "  aviso contestado con $($e.Current.Name)"
                    Invocar $e
                    Start-Sleep -Seconds 1
                    break
                }
            }
        }
    }
}

$bin = "C:\Program Files\Cisco Packet Tracer 9.0.1\bin"
# Sin ShellExecute: así el proceso hereda con certeza el escritorio de este script.
$arranque = New-Object System.Diagnostics.ProcessStartInfo
$arranque.FileName = "$bin\PacketTracer.exe"
$arranque.WorkingDirectory = $bin
$arranque.UseShellExecute = $false
$p = [System.Diagnostics.Process]::Start($arranque)
if ($env:PKTRUTAS_PID_OCULTO) { Set-Content -Path $env:PKTRUTAS_PID_OCULTO -Value $p.Id -Encoding ascii }
"Packet Tracer de armado: PID $($p.Id)"
try {
    $top = $null
    for ($i = 0; $i -lt 120 -and $null -eq $top; $i++) { Start-Sleep -Milliseconds 500; $top = Ventana $p.Id "CAppWindow" }
    if ($null -eq $top) { throw "no abrio la ventana principal" }
    Start-Sleep -Seconds 5
    # El editor no acepta el ID de un módulo ya agregado, y lo dice con un aviso que oculto
    # nadie ve. Si está agregado se quita, sólo aquí: este Packet Tracer se cierra a la
    # fuerza y no guarda opciones (con -DejarAbierto, no lo cierres guardando).
    AbrirDeScripting "Configure PT Script Modules ..."
    $c = $null
    for ($i = 0; $i -lt 40 -and $null -eq $c; $i++) { Start-Sleep -Milliseconds 250; $c = Ventana $p.Id "CConfigScriptModules" }
    if ($null -eq $c) { throw "no abrio Configure" }
    Start-Sleep -Seconds 1
    $ya = $c.FindAll($TS::Descendants, $TODOS) | Where-Object { (Tipo $_) -eq "TreeItem" -and $_.Current.Name -eq "PktRutas" } | Select-Object -First 1
    if ($ya) {
        "paso: quitar el ya agregado, solo en esta sesion"
        $ya.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
        Start-Sleep -Milliseconds 500
        Invocar (Buscar $c "Remove" "Button")
        Start-Sleep -Seconds 2
        ContestarAvisos
        $sigue = $c.FindAll($TS::Descendants, $TODOS) | Where-Object { (Tipo $_) -eq "TreeItem" -and $_.Current.Name -eq "PktRutas" } | Select-Object -First 1
        if ($sigue) { throw "no se pudo quitar el modulo ya agregado" }
    }
    Invocar (Buscar $c "Ok" "Button")
    Start-Sleep -Seconds 1
    AbrirDeScripting "New PT Script Module ..."
    $w = $null
    for ($i = 0; $i -lt 40 -and $null -eq $w; $i++) { Start-Sleep -Milliseconds 250; $w = Ventana $p.Id "CScriptingInterface" }
    if ($null -eq $w) { throw "no abrio el editor de modulos" }
    Start-Sleep -Seconds 2
    $w = Ventana $p.Id "CScriptingInterface"

    # Oculto, un atorón no se ve: estos pasos dicen hasta dónde llegó.
    "paso: datos"
    Pestana $w "General"
    Valor $w "App Name" "PktRutas"
    Valor $w "App ID" "io.github.quesitooaxaca21.PktRutas"
    Valor $w "App Version" $VERSION
    Valor $w "App Author" "QuesitoOaxaca21"
    Valor $w "App Contact" "https://github.com/QuesitoOaxaca21/PktRutas"
    Valor $w "App Description" "Revisa los combos de las notas del lienzo y configura la practica desde Packet Tracer."
    "paso: permisos"
    foreach ($n in $PERMISOS) {
        $t = (Buscar $w $n "CheckBox").GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
        if ($t.Current.ToggleState -ne "On") { $t.Toggle() }
    }
    (Buscar $w "On Startup" "RadioButton").GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()

    "paso: scripts"
    Pestana $w "Script Engine"
    Invocar (Buscar $w "Import File" "Button" -Visible)
    $dlg = DialogoArchivos $w
    LlenarDialogo $dlg $M
    Start-Sleep -Seconds 1
    LlenarDialogo $dlg $SCRIPTS
    Start-Sleep -Seconds 2

    "paso: ventana"
    Pestana $w "Custom Interfaces"
    Invocar (Buscar $w "Import File" "Button" -Visible)
    $dlg = DialogoArchivos $w
    LlenarDialogo $dlg (Join-Path $M "ventana.htm")
    Start-Sleep -Seconds 2

    "paso: exportar"
    Pestana $w "Info"
    Invocar (Buscar $w "Export" "Button" -Visible)
    $dlg = DialogoArchivos $w
    "dialogo de guardar: " + $dlg.Current.Name
    # Se escribe aparte y se cambia al final: si algo falla, el .pts anterior sigue ahí.
    $nuevo = Join-Path (Split-Path -Parent $Salida) ("nuevo_" + (Split-Path -Leaf $Salida))
    if (Test-Path $nuevo) { Remove-Item $nuevo }
    LlenarDialogo $dlg $nuevo
    for ($i = 0; $i -lt 40 -and -not (Test-Path $nuevo); $i++) { Start-Sleep -Milliseconds 250 }
    if (-not (Test-Path $nuevo)) { throw "no se escribio $nuevo" }
    Start-Sleep -Seconds 1
    Move-Item -Force $nuevo $Salida
    "listo: $Salida ($((Get-Item $Salida).Length) bytes)"
}
finally {
    if (-not $DejarAbierto) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
}
