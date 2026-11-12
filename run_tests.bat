@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set "PIP_DISABLE_PIP_VERSION_CHECK=1"
if exist ".venv\.installed" goto install
echo Hay chay run.bat truoc mot lan de cai moi truong.
pause
exit /b 1
:install
".venv\Scripts\python.exe" -m pip install --only-binary=:all: -r requirements-dev.txt
if errorlevel 1 goto failpip
cd backend
"..\.venv\Scripts\python.exe" -m pytest tests -v
echo.
echo Xong. Ket qua mong doi: dong cuoi ghi "passed", khong co "failed".
pause
exit /b 0
:failpip
echo [LOI] Cai thu vien kiem thu that bai.
pause
exit /b 1
