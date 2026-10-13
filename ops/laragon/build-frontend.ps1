# Construit l'interface Angular et la copie dans le dossier servi par Nginx.
param(
    [string]$ApiUrl = 'https://gmao.test',
    [string]$Target = 'C:\GMAO\web',
    [switch]$SkipTests
)
$ErrorActionPreference = 'Stop'
$front = (Resolve-Path (Join-Path $PSScriptRoot '..\..\gmao-frontend')).Path
Set-Location $front

npm ci
if ($LASTEXITCODE -ne 0) { throw 'npm ci a échoué.' }
if (-not $SkipTests) {
    npm run test:ci
    if ($LASTEXITCODE -ne 0) { throw 'Les tests frontend ont échoué : build annulé.' }
}
$env:GMAO_API_URL = $ApiUrl
npm run build:production
if ($LASTEXITCODE -ne 0) { throw 'Le build de production a échoué.' }

$output = Join-Path $front 'dist\gmao-frontend\browser'
if (-not (Test-Path (Join-Path $output 'index.html'))) { throw "Build introuvable : $output" }
New-Item -ItemType Directory -Force -Path $Target | Out-Null
# /MIR remplace le contenu : les anciens fichiers à empreinte disparaissent.
robocopy $output $Target /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "La copie vers $Target a échoué (robocopy $LASTEXITCODE)." }
Write-Host "Interface publiée dans $Target (API : $ApiUrl)"
exit 0
