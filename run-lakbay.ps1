$ErrorActionPreference = 'Stop'
$port = 8000
$url = "http://127.0.0.1:$port/index.html"

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
  $python = (Get-Command python -ErrorAction Stop).Source
  Start-Process -FilePath $python `
    -ArgumentList @('-m', 'http.server', "$port", '--bind', '127.0.0.1') `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden

  $ready = $false
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      $response = Invoke-WebRequest -Uri $url -Method Head -TimeoutSec 2
      if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { throw "Lakbay's local server did not start on port $port." }
}

Start-Process $url
