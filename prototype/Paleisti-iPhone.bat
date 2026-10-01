@echo off
rem Vilnius Commute for the iPhone app: starts the server so the phone on the
rem same Wi-Fi can load it, and opens the page with the QR code to scan.
rem With cloudflared installed (or cloudflared.exe beside this file) the phone
rem reaches it away from home too.
cd /d "%~dp0"
where python >nul 2>nul || (echo Nerastas Python. Idiek is https://www.python.org/downloads/ && pause && exit /b 1)

netstat -an | find ":8765" | find "LISTENING" >nul
if not errorlevel 1 (
  echo Uostas 8765 jau uzimtas: uzdaryk kita serverio langa ir paleisk dar karta.
  pause
  exit /b 1
)

echo.
echo  Kaip prijungti iPhone:
echo   1. Narsykleje atsidarys puslapis su QR kodu.
echo   2. Nuskenuok ji iPhone kamera ir paliesk "Atidaryti Vilnius".
echo   3. Jei Windows paklaus, ar leisti Python priimti rysius, spausk "Allow".
echo  Sis langas turi likti atidarytas. Sustabdyti: Ctrl+C.
echo.

set MODE=--lan
where cloudflared >nul 2>nul && set MODE=--tunnel
if exist cloudflared.exe set MODE=--tunnel

python server.py %MODE% --open
pause
