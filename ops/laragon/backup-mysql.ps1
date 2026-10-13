# Sauvegarde complète de la base GMAO (mysqldump compressé) avec rotation.
# Le mot de passe est lu dans la variable d'environnement GMAO_BACKUP_DB_PASSWORD (jamais en argument).
param(
    [string]$Database = 'gmao',
    [string]$DbUser = 'gmao_backup',
    [string]$DbHost = '127.0.0.1',
    [string]$OutDir = 'C:\GMAO\backups',
    [int]$KeepDays = 30,
    [string]$MysqlBin = 'C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin'
)
$ErrorActionPreference = 'Stop'
$password = $env:GMAO_BACKUP_DB_PASSWORD
if (-not $password) { throw 'Variable GMAO_BACKUP_DB_PASSWORD absente.' }
$dump = Join-Path $MysqlBin 'mysqldump.exe'
if (-not (Test-Path $dump)) { throw "mysqldump introuvable : $dump" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$stamp = Get-Date -Format 'yyyyMMddTHHmmss'
$sql = Join-Path $OutDir "gmao-$stamp.sql"
$zip = Join-Path $OutDir "gmao-$stamp.zip"
$cnf = Join-Path ([IO.Path]::GetTempPath()) "gmao-backup-$([guid]::NewGuid().ToString('N')).cnf"
try {
    Set-Content -LiteralPath $cnf -Encoding ASCII -Value "[client]`nuser=$DbUser`npassword=`"$password`"`nhost=$DbHost"
    & $dump "--defaults-extra-file=$cnf" --single-transaction --routines --no-tablespaces --default-character-set=utf8mb4 "--result-file=$sql" $Database
    if ($LASTEXITCODE -ne 0) { throw "mysqldump a échoué (code $LASTEXITCODE)." }
    if ((Get-Item $sql).Length -lt 1024) { throw 'Sauvegarde anormalement petite : vérifier la base.' }
    Compress-Archive -LiteralPath $sql -DestinationPath $zip
} finally {
    Remove-Item -LiteralPath $cnf -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $sql -Force -ErrorAction SilentlyContinue
}
Get-ChildItem -LiteralPath $OutDir -Filter 'gmao-*.zip' |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } |
    Remove-Item -Force
Write-Host "Sauvegarde créée : $zip"
