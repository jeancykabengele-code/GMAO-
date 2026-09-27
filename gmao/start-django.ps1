$ErrorActionPreference = 'Stop'
$env:DJANGO_DEBUG = 'true'
& "$PSScriptRoot\.venv\Scripts\python.exe" "$PSScriptRoot\manage.py" migrate --noinput
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$PSScriptRoot\.venv\Scripts\python.exe" "$PSScriptRoot\manage.py" verify_business_schema
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& "$PSScriptRoot\.venv\Scripts\python.exe" "$PSScriptRoot\manage.py" runserver 0.0.0.0:8080 --noreload
