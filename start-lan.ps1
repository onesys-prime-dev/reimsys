# Runs REIMSYS so a phone on the same Wi-Fi can open it.
# Usage:  powershell -ExecutionPolicy Bypass -File .\start-lan.ps1
# Then open  https://<this PC's Wi-Fi address>:4000  on the phone (http if OpenSSL is not installed).
# Https is needed so the phone lets "Scan receipt" open its live camera. The first time, the phone warns that the
# certificate is not from a known company (this PC made it): choose Advanced, then Continue.

$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
Set-Location $PSScriptRoot

# The Wi-Fi address of this PC (skips virtual adapters such as VMware).
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|Ethernet' -and $_.InterfaceAlias -notmatch 'VMware|vEthernet|Bluetooth|Loopback' -and $_.IPAddress -notmatch '^169\.' } |
  Select-Object -First 1).IPAddress
if (-not $ip) { throw 'Could not find a network address. Connect to Wi-Fi first.' }

# A certificate for this PC's address, made once (and again if the address changes). It stays in .lan-cert and is never committed.
$certDir = Join-Path $PSScriptRoot '.lan-cert'
$cert = Join-Path $certDir 'cert.pem'
$key = Join-Path $certDir 'key.pem'
$ipFile = Join-Path $certDir 'ip.txt'
$openssl = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $openssl) { foreach ($p in 'C:\Program Files\Git\usr\bin\openssl.exe', 'C:\Program Files\OpenSSL-Win64\bin\openssl.exe') { if (Test-Path $p) { $openssl = $p; break } } }
$https = $false
if ($openssl) {
  New-Item -ItemType Directory -Force $certDir | Out-Null
  if (-not (Test-Path $cert) -or -not (Test-Path $ipFile) -or ((Get-Content $ipFile) -ne $ip)) {
    # OpenSSL prints its progress dots on stderr, which this script (set to stop on errors) would take for a failure.
    $stop = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $openssl req -x509 -newkey rsa:2048 -nodes -keyout $key -out $cert -days 825 -subj '/CN=REIMSYS local' -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:$ip" 2>$null
    $ErrorActionPreference = $stop
    Set-Content $ipFile $ip
  }
  $https = (Test-Path $cert) -and (Test-Path $key)
}
if (-not $https) { Write-Host "OpenSSL was not found, so this runs on plain http and the phone cannot open the live camera (it will use its camera app)." -ForegroundColor Yellow }
$scheme = if ($https) { 'https' } else { 'http' }

Write-Host "Building..." -ForegroundColor Cyan
pnpm build | Out-Null

# Free the port if an older copy is running.
Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

$env:WEB_ORIGIN = "${scheme}://${ip}:4000,${scheme}://localhost:4000"
if ($https) { $env:TLS_CERT = $cert; $env:TLS_KEY = $key }
Write-Host ""
Write-Host "Phone (same Wi-Fi):  ${scheme}://${ip}:4000" -ForegroundColor Green
Write-Host "This PC:             ${scheme}://localhost:4000" -ForegroundColor Green
if ($https) { Write-Host "The phone warns about the certificate once: choose Advanced, then Continue." -ForegroundColor Yellow }
Write-Host "Sign in with admin@example.com / Reimsys#2026   (Ctrl+C to stop)" -ForegroundColor Green
Write-Host ""
Set-Location apps\api
node dist\server.js
