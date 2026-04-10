$ErrorActionPreference = 'Stop'

$rhubarbVersion = "1.13.0"
$zipUrl = "https://github.com/DanielSWolf/rhubarb-lip-sync/releases/download/v$rhubarbVersion/Rhubarb-Lip-Sync-$rhubarbVersion-Windows.zip"

# Setup directories
$baseDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$binDir = Join-Path (Split-Path -Parent $baseDir) "bin" # Points to backend/bin
$tempDir = Join-Path $env:TEMP "rhubarb_temp"
$zipPath = Join-Path $tempDir "rhubarb.zip"

If (-not (Test-Path $binDir)) { New-Item -ItemType Directory -Path $binDir | Out-Null }
If (-not (Test-Path $tempDir)) { New-Item -ItemType Directory -Path $tempDir | Out-Null }

Write-Host "Downloading Rhubarb Lip Sync v$rhubarbVersion for Windows..."
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath

Write-Host "Extracting to $binDir..."
Expand-Archive -Path $zipPath -DestinationPath $binDir -Force

Write-Host "Cleaning up temp files..."
Remove-Item -Path $tempDir -Recurse -Force

$exePath = Join-Path $binDir "Rhubarb-Lip-Sync-$rhubarbVersion-Windows\rhubarb.exe"

Write-Host "`n✅ Installation Complete!"
Write-Host "Rhubarb executable is located at: $exePath"
Write-Host "To use this locally, update the initialization in 'backend/core/rhubarb.py' to:"
Write-Host "rhubarb_syncer = RhubarbLipSync(rhubarb_path=r'$exePath')"
