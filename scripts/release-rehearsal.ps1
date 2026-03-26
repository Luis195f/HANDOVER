param(
  [ValidateSet("preflight", "package", "postdeploy", "perf")]
  [string]$Stage = "preflight",
  [string]$StagingEnv = "config/staging.env",
  [string]$BaseUrl,
  [string]$PilotControlUrl,
  [string]$BearerToken,
  [int]$PerfIterations = 3,
  [switch]$SkipPytest,
  [switch]$SkipDockerConfig
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$PythonCommand = if (Get-Command "python.exe" -ErrorAction SilentlyContinue) {
  "python.exe"
} elseif (Get-Command "python" -ErrorAction SilentlyContinue) {
  "python"
} else {
  throw "python or python.exe is required to run performance smoke"
}

function Invoke-External {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [string[]]$Arguments = @()
  )

  Write-Host ("> {0} {1}" -f $Command, ($Arguments -join " ")) -ForegroundColor DarkGray
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw ("Command failed with exit code {0}: {1}" -f $LASTEXITCODE, $Command)
  }
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [scriptblock]$Action
  )

  Write-Host ("== {0} ==" -f $Name) -ForegroundColor Cyan
  & $Action
  Write-Host ("OK: {0}" -f $Name) -ForegroundColor Green
}

switch ($Stage) {
  "preflight" {
    Invoke-Step "Git diff check" { Invoke-External "git" @("diff", "--check") }
    Invoke-Step "Typecheck" { Invoke-External "pnpm" @("-w", "typecheck") }
    Invoke-Step "Lint" { Invoke-External "pnpm" @("-w", "lint:ci") }
    Invoke-Step "Frontend tests" { Invoke-External "pnpm" @("test") }
    Invoke-Step "FHIR validation fixtures" { Invoke-External "pnpm" @("-w", "validate:fhir") }
    if (-not $SkipPytest) {
      Invoke-Step "Backend pytest" {
        Invoke-External "pytest" @("--ds=backend.settings", "--disable-socket", "--allow-hosts=127.0.0.1,localhost", "backend", "tests")
      }
    }
    if (-not $SkipDockerConfig) {
      Invoke-Step "Docker compose config" {
        Invoke-External "docker" @("compose", "--env-file", $StagingEnv, "config")
      }
    }
  }
  "package" {
    Invoke-Step "Safe ZIP package" {
      Invoke-External "pwsh" @("-File", (Join-Path $PSScriptRoot "zip-project.ps1"))
    }
  }
  "perf" {
    Invoke-Step "Synthetic performance smoke" {
      Invoke-External $PythonCommand @((Join-Path $PSScriptRoot "perf-smoke.py"), "--iterations", $PerfIterations.ToString())
    }
  }
  "postdeploy" {
    if (-not $BaseUrl) {
      throw "BaseUrl is required for postdeploy smoke"
    }
    Invoke-Step "Web root smoke" {
      $response = Invoke-WebRequest -Uri $BaseUrl -MaximumRedirection 5
      if ($response.StatusCode -ge 400) {
        throw ("Unexpected web status code: {0}" -f $response.StatusCode)
      }
    }
    if ($PilotControlUrl) {
      if (-not $BearerToken) {
        throw "BearerToken is required when PilotControlUrl is provided"
      }
      Invoke-Step "Pilot control smoke" {
        $headers = @{ Authorization = "Bearer $BearerToken" }
        $response = Invoke-WebRequest -Uri $PilotControlUrl -Headers $headers
        if ($response.StatusCode -ge 400) {
          throw ("Unexpected pilot-control status code: {0}" -f $response.StatusCode)
        }
      }
    }
  }
}
