# Runs REIMSIS so a phone on the same Wi-Fi can open it.
# Usage:  powershell -ExecutionPolicy Bypass -File .\start-lan.ps1
# Then open  http://<this PC's Wi-Fi address>:4000  on the phone.

$ErrorActionPreference = 'Stop'
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
Set-Location $PSScriptRoot

# The Wi-Fi address of this PC (skips virtual adapters such as VMware).
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.InterfaceAlias -match 'Wi-?Fi|Ethernet' -and $_.InterfaceAlias -notmatch 'VMware|vEthernet|Bluetooth|Loopback' -and $_.IPAddress -notmatch '^169\.' } |
  Select-Object -First 1).IPAddress
if (-not $ip) { throw 'Could not find a network address. Connect to Wi-Fi first.' }

Write-Host "Building..." -ForegroundColor Cyan
pnpm build | Out-Null

# Free the port if an older copy is running.
Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

$env:WEB_ORIGIN = "http://${ip}:4000,http://localhost:4000"
Write-Host ""
Write-Host "Phone (same Wi-Fi):  http://${ip}:4000" -ForegroundColor Green
Write-Host "This PC:             http://localhost:4000" -ForegroundColor Green
Write-Host "Sign in with admin@example.com / Reimsis#2026   (Ctrl+C to stop)" -ForegroundColor Green
Write-Host ""
Set-Location apps\api
node dist\server.js
