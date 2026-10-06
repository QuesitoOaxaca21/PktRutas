@echo off
rem Abre la ventana de PktRutas. No deja consola abierta: si algo falla, el
rem detalle queda en error.log, junto a este archivo.
rem Arrastra un archivo .pkt sobre este archivo para abrirlo ya analizado.
cd /d "%~dp0"

rem Abierto desde dentro del .zip, Windows solo extrae este archivo.
if not exist "app.py" goto sin_carpeta
if not exist "pkt\modelo.py" goto sin_carpeta

rem Primero el lanzador de python.org (py / pyw): viene firmado, y el Control
rem inteligente de aplicaciones de Windows 11 bloquea los Python sin firma
rem (como el de MSYS2) aunque vayan antes en el PATH.
set "PY="
set "PYW="
where py >nul 2>nul && where pyw >nul 2>nul && (set "PY=py -3" & set "PYW=pyw -3")
if not defined PY where python >nul 2>nul && where pythonw >nul 2>nul && (set "PY=python" & set "PYW=pythonw")
if not defined PY goto sin_python

rem Python 3.10 o mas nuevo, con tkinter (la ventana).
%PY% -c "import sys, tkinter; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul || goto sin_python

start "" %PYW% app.py %*
exit /b 0

:sin_python
echo.
echo   PktRutas necesita Python 3.10 o mas nuevo, con tkinter.
echo.
echo   Descargalo de https://www.python.org/downloads/ e instalalo con las
echo   opciones que trae marcadas: incluyen tkinter y el lanzador "py".
echo   Despues vuelve a abrir Analizar.bat.
echo.
pause
exit /b 1

:sin_carpeta
echo.
echo   Falta el resto del programa junto a Analizar.bat.
echo.
echo   Si lo abriste desde dentro del .zip: descomprime primero la carpeta
echo   completa (clic derecho, Extraer todo) y abre Analizar.bat desde ahi.
echo.
pause
exit /b 1
