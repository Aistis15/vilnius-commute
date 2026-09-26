@echo off
rem Vilnius Commute: paleidzia programele ir atidaro ja narsykleje.
cd /d "%~dp0"
where python >nul 2>nul || (echo Nerastas Python. Idiek is https://www.python.org/downloads/ && pause && exit /b 1)
start "" /min cmd /c "timeout /t 3 >nul & start http://localhost:8765"
python server.py
pause
