# Crée l'environnement Python de l'API GMAO avec le Python de Laragon.
param(
    [string]$Python = 'C:\laragon\bin\python\python-3.13\python.exe'
)
$ErrorActionPreference = 'Stop'
$api = (Resolve-Path (Join-Path $PSScriptRoot '..\..\gmao')).Path
if (-not (Test-Path $Python)) { throw "Python introuvable : $Python (indiquer -Python <chemin>)." }

& $Python -m venv (Join-Path $api '.venv-laragon')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$venvPython = Join-Path $api '.venv-laragon\Scripts\python.exe'
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r (Join-Path $api 'requirements.txt')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "API installée dans $api\.venv-laragon"
