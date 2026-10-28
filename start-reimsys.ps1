# Starts REIMSYS: the MySQL database (if it is not already running), then the API and the web app. Run by the "REIMSYS start" scheduled task at sign-in.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$log = Join-Path $root '.dev.log'

function Listening($port) { [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) }

if (-not (Listening 3306)) {
  Start-Process -FilePath 'C:\xampp\mysql\bin\mysqld.exe' -ArgumentList '--defaults-file=C:\xampp\mysql\bin\my.ini', '--standalone' -WindowStyle Hidden
  for ($i = 0; $i -lt 30 -and -not (Listening 3306); $i++) { Start-Sleep -Seconds 1 }
}
if (-not (Listening 4000) -and -not (Listening 5173)) {
  Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-Command', "Set-Location '$root'; pnpm build *> '$log'; pnpm dev *>> '$log'" -WindowStyle Hidden
}
