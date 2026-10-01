@echo off
rem Vilnius Commute telefone: paleidzia serveri ir Expo, kad programele
rem atsidarytu iPhone per Expo Go. "Paleisti-telefone.bat lan" - be tunelio.
cd /d "%~dp0"
where python >nul 2>nul || (echo Nerastas Python. Idiek is https://www.python.org/downloads/ && pause && exit /b 1)
where node >nul 2>nul || (echo Nerastas Node.js. Idiek LTS versija is https://nodejs.org/ && pause && exit /b 1)

rem Serveris lieka tik siame kompiuteryje; telefonas ji pasiekia per Expo (/vc/).
netstat -an | find ":8765" | find "LISTENING" >nul
if errorlevel 1 (
  echo Paleidziamas programeles serveris atskirame lange...
  start "Vilnius Commute serveris" /min python server.py
) else (
  echo Programeles serveris jau veikia.
)

if not exist "expo\node_modules\" (
  echo Pirmas paleidimas: diegiami Expo paketai, tai gali uztrukti kelias minutes...
  pushd expo
  call npm install
  if errorlevel 1 (popd & echo Nepavyko idiegti paketu. & pause & exit /b 1)
  popd
)

cd expo
rem Expo Go for iPhone (SDK 57) opens a project only when this computer and
rem the app are signed in to the same Expo account.
call npx expo whoami >nul 2>nul
if errorlevel 1 (
  echo Prisijunk prie savo Expo paskyros: el. pastas arba vardas ir slaptazodis. Paskyra kuriama expo.dev svetaineje.
  call npx expo login
)

set MODE=--tunnel
if /i "%~1"=="lan" set MODE=--lan

echo.
echo  Kaip atidaryti iPhone:
echo   1. Idiek "Expo Go" is App Store.
echo   2. Expo Go programeleje prisijunk ta pacia Expo paskyra: Home, avataras virsuje desineje.
echo   3. Kai zemiau atsiras QR kodas, nuskenuok ji iPhone kamera ir atidaryk Expo Go.
if /i "%MODE%"=="--lan" (
  echo   4. iPhone ir kompiuteris turi buti tame paciame Wi-Fi tinkle.
) else (
  echo   4. Veikia per interneta, net jei Wi-Fi tinklas telefono nemato.
)
echo  Sustabdyti: Ctrl+C siame lange.
echo.

call npx expo start %MODE%
pause
