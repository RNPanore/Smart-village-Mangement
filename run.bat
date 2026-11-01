@echo off
cd /d "%~dp0backend"
python -m pip install -q -r requirements.txt
if errorlevel 1 pause & exit /b 1
python app.py
pause
