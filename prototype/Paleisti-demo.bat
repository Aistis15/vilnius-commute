@echo off
rem Vilnius Commute DEMO (pristatymui): autobusai rodomi ten, kur juos deda
rem tvarkarastis, todel nereikia stops.lt. Bandymu pulte atsiranda mygtukai
rem "Veluoja 4 min" / "Veluoja 12 min".
rem   Paleisti-demo.bat            - dabartinis laikas
rem   Paleisti-demo.bat 08:10      - laikrodis nuo 08:10 siandien (rytinis pikas)
rem   Paleisti-demo.bat 08:10 lan  - ir telefonas per ta pati Wi-Fi, be tunelio
cd /d "%~dp0"
where python >nul 2>nul || (echo Nerastas Python. Idiek is https://www.python.org/downloads/ && pause && exit /b 1)

netstat -an | find ":8765" | find "LISTENING" >nul
if not errorlevel 1 (
  echo Uostas 8765 jau uzimtas: uzdaryk kita serverio langa ir paleisk dar karta.
  pause
  exit /b 1
)

echo Paleidziamas DEMO serveris atskirame lange...
start "Vilnius Commute DEMO serveris" /min python server.py --demo %~1
rem Palaukiam, kol serveris klausosi, kad Paleisti-telefone.bat nepaleistu antro.
set /a WAITED=0
:wait
netstat -an | find ":8765" | find "LISTENING" >nul
if not errorlevel 1 goto ready
set /a WAITED+=1
if %WAITED% GEQ 20 (echo Serveris nepasileido. Ziurek jo langa. & pause & exit /b 1)
timeout /t 1 /nobreak >nul
goto wait
:ready

rem Kompiuteryje: http://localhost:8765. Telefone: Expo Go, kaip Paleisti-telefone.bat.
where node >nul 2>nul || (echo Node.js nerastas: demo veikia tik kompiuteryje, http://localhost:8765 && start "" http://localhost:8765 && pause && exit /b 0)
call Paleisti-telefone.bat %~2
