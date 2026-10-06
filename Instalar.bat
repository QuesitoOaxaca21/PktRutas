@echo off
rem Instala PktRutas para este usuario, sin permisos de administrador:
rem copia el programa a %LOCALAPPDATA%\Programs\PktRutas y crea sus accesos
rem directos (menu Inicio, escritorio y "Enviar a"). Volver a correrlo
rem actualiza la instalacion. Para quitarlo: Configuracion, Aplicaciones.
rem   Instalar.bat --sin-escritorio    sin el acceso del escritorio
cd /d "%~dp0"
title Instalar PktRutas

rem Abierto desde dentro del .zip, Windows solo extrae este archivo.
if not exist "instalar.py" goto sin_carpeta
if not exist "pkt\modelo.py" goto sin_carpeta

rem Primero el lanzador de python.org (py): viene firmado, y el Control
rem inteligente de aplicaciones de Windows 11 bloquea los Python sin firma.
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY goto sin_python

rem Python 3.10 o mas nuevo, con tkinter (la ventana).
%PY% -c "import sys, tkinter; sys.exit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>nul || goto sin_python

%PY% instalar.py %*
set "CODIGO=%errorlevel%"
echo.
pause
exit /b %CODIGO%

:sin_python
echo.
echo   PktRutas necesita Python 3.10 o mas nuevo, con tkinter.
echo.
echo   Se va a abrir la pagina de python.org. Descarga Python e instalalo
echo   con las opciones que trae marcadas: incluyen tkinter y el lanzador
echo   "py". Despues vuelve a abrir Instalar.bat.
echo.
pause
start "" "https://www.python.org/downloads/"
exit /b 1

:sin_carpeta
echo.
echo   Falta el resto del programa junto a Instalar.bat.
echo.
echo   Si lo abriste desde dentro del .zip: descomprime primero la carpeta
echo   completa (clic derecho, Extraer todo) y abre Instalar.bat desde ahi.
echo.
pause
exit /b 1
