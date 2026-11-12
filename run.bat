@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title Tai chinh va Lich Freelance
set "PIP_DISABLE_PIP_VERSION_CHECK=1"
set "OKVER=import sys; sys.exit(0 if (3,12) <= sys.version_info[:2] <= (3,14) else 1)"

rem ===== 1. Tim Python phu hop: 3.13, 3.12 hoac 3.14 =====
set "PY="
call :trypy 3.13
call :trypy 3.12
call :trypy 3.14
if defined PY goto havepy
python -c "%OKVER%" <nul >nul 2>nul
if not errorlevel 1 set "PY=python"
if defined PY goto havepy

echo.
echo Khong tim thay Python 3.12, 3.13 hoac 3.14.
echo Ung dung chua chay duoc tren Python 3.15 vi mot so thu vien chua ho tro.
where py >nul 2>nul
if errorlevel 1 goto manual
echo Dang thu tu dong cai them Python 3.13 bang lenh: py install 3.13
echo Python 3.15 hien co cua ban se duoc giu nguyen.
echo.
py install 3.13
call :trypy 3.13
if defined PY goto havepy

:manual
echo.
echo [LOI] Chua cai duoc Python 3.13. Hay lam thu cong:
echo   1. Mo trang https://www.python.org/downloads/windows/
echo   2. Tai "Windows installer 64-bit" cua ban Python 3.13 moi nhat va cai dat.
echo   3. Chay lai run.bat
echo.
pause
exit /b 1

:havepy
echo Dung Python: %PY%

rem ===== 2. Moi truong rieng .venv, tao lai neu dang dung Python khong phu hop =====
if not exist ".venv\Scripts\python.exe" goto makevenv
".venv\Scripts\python.exe" -c "%OKVER%" <nul >nul 2>nul
if not errorlevel 1 goto checkinstall
echo Moi truong cu duoc tao bang Python khong phu hop, dang xoa de tao lai...
rmdir /s /q ".venv"
:makevenv
echo Dang tao moi truong Python rieng cho ung dung...
%PY% -m venv .venv
if errorlevel 1 goto failvenv

rem ===== 3. Cai thu vien, chi lam 1 lan =====
:checkinstall
if exist ".venv\.installed" goto start
echo Dang cai thu vien can thiet - chi lam 1 lan, can Internet...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install --only-binary=:all: -r requirements.txt
if errorlevel 1 goto failpip
echo ok> ".venv\.installed"

rem ===== 4. Chay ung dung =====
:start
cd backend
"..\.venv\Scripts\python.exe" -m app --open
echo.
echo Ung dung da dung. Neu co dong bao loi o tren, hay chup man hinh gui lai.
pause
exit /b 0

:failvenv
echo.
echo [LOI] Khong tao duoc moi truong .venv. Thu xoa thu muc .venv roi chay lai.
pause
exit /b 1

:failpip
echo.
echo [LOI] Cai thu vien that bai. Kiem tra ket noi Internet roi chay lai run.bat.
echo Neu van loi, chup man hinh cua so nay gui lai.
pause
exit /b 1

rem ===== Ham: thu mot phien ban Python qua lenh py =====
:trypy
if defined PY exit /b 0
py -%1 -c "import sys" <nul >nul 2>nul
if errorlevel 1 exit /b 0
set "PY=py -%1"
exit /b 0
