$ErrorActionPreference = 'Stop'
$env:DJANGO_DEBUG = 'true'
& "$PSScriptRoot\.venv\Scripts\python.exe" "$PSScriptRoot\manage.py" runserver 0.0.0.0:8080 --noreload