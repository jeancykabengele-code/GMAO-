$ErrorActionPreference = 'Stop'

$runtimeDirectory = Join-Path $PSScriptRoot '.runtime'
$credentialPath = Join-Path $runtimeDirectory 'supabase-db-password.xml'

if (Test-Path -LiteralPath $credentialPath) {
    $securePassword = Import-Clixml -LiteralPath $credentialPath
}
else {
    $securePassword = Read-Host 'Mot de passe PostgreSQL Supabase (une seule fois)' -AsSecureString
    $secureConfirmation = Read-Host 'Confirmez le mot de passe PostgreSQL Supabase' -AsSecureString
    $passwordCheck = [PSCredential]::new('postgres', $securePassword).GetNetworkCredential().Password
    $confirmation = [PSCredential]::new('postgres', $secureConfirmation).GetNetworkCredential().Password

    if ($passwordCheck -cne $confirmation) {
        throw 'Les deux saisies du mot de passe ne correspondent pas. Relancez le script.'
    }
    if ($passwordCheck.Length -lt 12) {
        throw 'Le mot de passe doit contenir au moins 12 caractères.'
    }

    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $securePassword | Export-Clixml -LiteralPath $credentialPath
    $passwordCheck = $null
    $confirmation = $null
}

$password = [PSCredential]::new('postgres', $securePassword).GetNetworkCredential().Password
try {
    $env:SUPABASE_DB_HOST = 'aws-0-eu-central-1.pooler.supabase.com'
    $env:SUPABASE_DB_PORT = '5432'
    $env:SUPABASE_DB_NAME = 'postgres'
    $env:SUPABASE_DB_USERNAME = 'postgres.rgujwidwlqesukqwgnib'
    $env:SUPABASE_DB_PASSWORD = $password
    $env:DJANGO_DEBUG = 'true'
    & "$PSScriptRoot\.venv\Scripts\python.exe" "$PSScriptRoot\manage.py" runserver 0.0.0.0:8080 --noreload
}
finally {
    Remove-Item Env:SUPABASE_DB_HOST -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_DB_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_DB_NAME -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_DB_USERNAME -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
    $password = $null
}