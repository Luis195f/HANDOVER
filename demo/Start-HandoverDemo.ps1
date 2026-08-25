[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('Start', 'Stop', 'Clean', 'Export')]
    [string]$Action = 'Start',

    [ValidateRange(30, 600)]
    [int]$ReadyTimeoutSeconds = 180,

    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$ExportName = 'export',

    [switch]$OpenEdge
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:ExpectedBranch = 'release/mvp-advanced-demo-rc'
$script:WebPort = 19006
$script:LoopbackPort = 19007
$script:RepoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:TempRoot = Join-Path $script:RepoRoot '.tmp\handover-demo'
$script:StatePath = Join-Path $script:TempRoot 'state.json'
$script:StartedProcesses = @()

function Assert-Repository {
    $gitRoot = (& git rev-parse --show-toplevel 2>$null | Select-Object -First 1)
    $gitRootSucceeded = $?
    if (-not $gitRootSucceeded -or -not $gitRoot) {
        throw 'The launcher must run from a Git worktree.'
    }

    $resolvedGitRoot = [System.IO.Path]::GetFullPath([string]$gitRoot)
    if (-not $resolvedGitRoot.Equals($script:RepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Repository mismatch. Expected: $script:RepoRoot; found: $resolvedGitRoot"
    }

    $branch = (& git branch --show-current 2>$null | Select-Object -First 1)
    $branchSucceeded = $?
    if (-not $branchSucceeded -or $branch -ne $script:ExpectedBranch) {
        throw "Wrong branch. Expected '$script:ExpectedBranch'; found '$branch'."
    }
}

function Get-NodePath {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) {
        throw 'Node.js is not installed or is not available in PATH.'
    }
    return $node.Source
}

function Assert-Dependencies {
    $requiredPaths = @(
        (Join-Path $script:RepoRoot 'node_modules'),
        (Join-Path $script:RepoRoot 'node_modules\expo\bin\cli'),
        (Join-Path $script:RepoRoot 'node_modules\@playwright\test'),
        (Join-Path $script:RepoRoot 'demo\demo-loopback-server.mjs')
    )
    foreach ($path in $requiredPaths) {
        if (-not (Test-Path -LiteralPath $path)) {
            throw "Missing existing dependency: $path. The launcher never installs dependencies."
        }
    }
    [void](Get-NodePath)
}

function Test-PortIsListening([int]$Port) {
    return [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners().Port -contains $Port
}

function Assert-PortsAvailable {
    $busy = @(@($script:WebPort, $script:LoopbackPort) | Where-Object { Test-PortIsListening $_ })
    if ($busy.Count -gt 0) {
        throw "Required loopback port(s) already in use: $($busy -join ', '). Run Stop, then inspect the owning PID before retrying."
    }
}

function Assert-PathUnderTemp([string]$Path) {
    $candidate = [System.IO.Path]::GetFullPath($Path)
    $safeRoot = [System.IO.Path]::GetFullPath($script:TempRoot).TrimEnd('\')
    $isRoot = $candidate.TrimEnd('\').Equals($safeRoot, [System.StringComparison]::OrdinalIgnoreCase)
    $isDescendant = $candidate.StartsWith($safeRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)
    if (-not $isRoot -and -not $isDescendant) {
        throw "Refusing operation outside the repository demo temp directory: $candidate"
    }
    return $candidate
}

function Get-DemoEnvironment {
    return @{
        'CI'                                         = '1'
        'EXPO_NO_TELEMETRY'                          = '1'
        'EXPO_PUBLIC_ENABLE_DEMO'                    = 'true'
        'EXPO_PUBLIC_E2E'                            = 'false'
        'EXPO_PUBLIC_API_BASE_URL'                   = "http://127.0.0.1:$script:LoopbackPort"
        'EXPO_PUBLIC_FHIR_BASE_URL'                  = "http://127.0.0.1:$script:LoopbackPort/fhir"
        'EXPO_PUBLIC_OIDC_ISSUER'                    = "http://127.0.0.1:$script:LoopbackPort"
        'EXPO_PUBLIC_OIDC_CLIENT_ID'                 = 'handover-local-demo'
        'EXPO_PUBLIC_OIDC_AUDIENCE'                  = 'handover-local-demo'
        'EXPO_PUBLIC_OIDC_SCOPE'                     = 'openid profile email offline_access'
        'EXPO_PUBLIC_OIDC_REDIRECT_SCHEME'           = 'handover-pro'
        'EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN'         = 'false'
        'EXPO_PUBLIC_ENABLE_ICEA_BRIDGE'             = 'false'
        'EXPO_PUBLIC_ENABLE_ICEA_IMMEDIATE_SCORING'  = 'false'
        'EXPO_PUBLIC_ENABLE_ICEA_ENRICHED_SCORING'   = 'false'
        'EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK'       = 'false'
        'EXPO_PUBLIC_AI_SUGGESTIONS_ENABLED'         = 'false'
        'EXPO_PUBLIC_AI_BACKEND_BASE_URL'            = "http://127.0.0.1:$script:LoopbackPort/disabled-ai"
    }
}

function Save-State {
    New-Item -ItemType Directory -Force -Path $script:TempRoot | Out-Null
    $state = [ordered]@{
        repoRoot = $script:RepoRoot
        branch = $script:ExpectedBranch
        createdAt = [DateTime]::UtcNow.ToString('o')
        processes = @($script:StartedProcesses | ForEach-Object {
            [ordered]@{
                name = $_.Name
                pid = $_.Process.Id
                startedAt = $_.Process.StartTime.ToUniversalTime().ToString('o')
            }
        })
    }
    $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $script:StatePath -Encoding utf8
}

function Start-ManagedProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [hashtable]$Environment = @{}
    )

    New-Item -ItemType Directory -Force -Path $script:TempRoot | Out-Null
    $stdout = Join-Path $script:TempRoot "$Name.stdout.log"
    $stderr = Join-Path $script:TempRoot "$Name.stderr.log"
    $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $script:RepoRoot `
        -NoNewWindow -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Environment $Environment
    $process.EnableRaisingEvents = $true
    $script:StartedProcesses += [pscustomobject]@{ Name = $Name; Process = $process }
    Save-State
    return $process
}

function Get-ProcessTreeIds([int]$RootPid) {
    $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $result = [System.Collections.Generic.List[int]]::new()
    function Add-Children([int]$ParentPid) {
        foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $ParentPid }) {
            Add-Children ([int]$child.ProcessId)
            $result.Add([int]$child.ProcessId)
        }
    }
    Add-Children $RootPid
    $result.Add($RootPid)
    return $result.ToArray()
}

function Stop-StateProcesses {
    if (-not (Test-Path -LiteralPath $script:StatePath)) {
        Write-Host 'No launcher state found; no process was stopped.'
        return
    }

    $state = Get-Content -Raw -LiteralPath $script:StatePath | ConvertFrom-Json
    $stateRoot = [System.IO.Path]::GetFullPath([string]$state.repoRoot)
    if (-not $stateRoot.Equals($script:RepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing state from another repository: $stateRoot"
    }

    $processEntries = @($state.processes)
    [Array]::Reverse($processEntries)
    $allStopped = $true
    foreach ($entry in $processEntries) {
        $process = Get-Process -Id ([int]$entry.pid) -ErrorAction SilentlyContinue
        if (-not $process) { continue }

        $expectedStart = if ($entry.startedAt -is [DateTime]) {
            $entry.startedAt.ToUniversalTime()
        } else {
            [DateTimeOffset]::Parse([string]$entry.startedAt).UtcDateTime
        }
        $actualStart = $process.StartTime.ToUniversalTime()
        if ([Math]::Abs(($actualStart - $expectedStart).TotalSeconds) -gt 5) {
            Write-Warning "PID $($entry.pid) was reused; refusing to stop it."
            $allStopped = $false
            continue
        }

        foreach ($pidToStop in Get-ProcessTreeIds ([int]$entry.pid)) {
            Stop-Process -Id $pidToStop -Force -ErrorAction SilentlyContinue
        }
    }

    if ($allStopped) {
        Remove-Item -LiteralPath $script:StatePath -Force -ErrorAction SilentlyContinue
        Write-Host 'Launcher processes stopped.'
    } else {
        Write-Warning "Some launcher processes were not stopped; state retained at $script:StatePath."
    }
}

function Wait-LoopbackReady([int]$TimeoutSeconds) {
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$script:LoopbackPort/health" -TimeoutSec 3
            if ($response.StatusCode -eq 200) { return }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Synthetic loopback did not become ready on port $script:LoopbackPort."
}

function Wait-ExpoReady([int]$TimeoutSeconds) {
    $baseUri = [Uri]"http://127.0.0.1:$script:WebPort/"
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $lastDetail = 'no response'

    do {
        try {
            $htmlResponse = Invoke-WebRequest -Uri $baseUri -TimeoutSec 5
            $html = [string]$htmlResponse.Content
            $matches = [regex]::Matches($html, '<script\s+[^>]*src=["'']([^"'']+)["''][^>]*>', 'IgnoreCase')
            foreach ($match in $matches) {
                $bundleUri = [Uri]::new($baseUri, $match.Groups[1].Value)
                $bundle = Invoke-WebRequest -Uri $bundleUri -TimeoutSec 15
                $bytes = [Text.Encoding]::UTF8.GetByteCount([string]$bundle.Content)
                $contentType = [string]$bundle.Headers.'Content-Type'
                if ($bundle.StatusCode -eq 200 -and $contentType -match 'javascript' -and $bytes -gt 800) {
                    return [pscustomobject]@{ HtmlBytes = [Text.Encoding]::UTF8.GetByteCount($html); BundleUri = $bundleUri; BundleBytes = $bytes }
                }
                $lastDetail = "bundle $bundleUri returned $bytes bytes"
            }
            if ($matches.Count -eq 0) { $lastDetail = "HTML returned without a script src ($($html.Length) chars)" }
        } catch {
            $lastDetail = $_.Exception.Message
        }
        Start-Sleep -Milliseconds 800
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Expo Web did not serve real HTML and JavaScript before timeout. Last result: $lastDetail"
}

function Start-EdgeContingency([string]$NodePath) {
    $edgeScript = Assert-PathUnderTemp (Join-Path $script:TempRoot 'open-edge.mjs')
    @'
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'msedge', headless: false });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:19006/', { waitUntil: 'domcontentloaded' });
const close = async () => { await browser.close(); process.exit(0); };
process.on('SIGINT', close);
process.on('SIGTERM', close);
await new Promise(() => {});
'@ | Set-Content -LiteralPath $edgeScript -Encoding utf8
    [void](Start-ManagedProcess -Name 'edge' -FilePath $NodePath -ArgumentList @($edgeScript))
}

function Start-Demo {
    Assert-Repository
    Assert-Dependencies
    Assert-PortsAvailable
    $node = Get-NodePath
    $environment = Get-DemoEnvironment
    $loopbackScript = Join-Path $script:RepoRoot 'demo\demo-loopback-server.mjs'
    $expoCli = Join-Path $script:RepoRoot 'node_modules\expo\bin\cli'

    try {
        $loopback = Start-ManagedProcess -Name 'loopback' -FilePath $node -ArgumentList @($loopbackScript, '--port', [string]$script:LoopbackPort)
        Wait-LoopbackReady -TimeoutSeconds 20

        $expo = Start-ManagedProcess -Name 'expo' -FilePath $node -ArgumentList @(
            $expoCli, 'start', '--web', '--no-dev', '--minify', '--clear',
            '--port', [string]$script:WebPort, '--host', 'localhost'
        ) -Environment $environment
        $ready = Wait-ExpoReady -TimeoutSeconds $ReadyTimeoutSeconds

        if ($OpenEdge) { Start-EdgeContingency -NodePath $node }

        Write-Host ''
        Write-Host 'HANDOVER synthetic behavioral-health demo is ready.'
        Write-Host "URL: http://127.0.0.1:$script:WebPort/"
        Write-Host "HTML: $($ready.HtmlBytes) bytes"
        Write-Host "JavaScript: $($ready.BundleBytes) bytes ($($ready.BundleUri))"
        Write-Host 'Press Ctrl+C to stop all launcher processes.'

        while (-not $expo.HasExited -and -not $loopback.HasExited) {
            Start-Sleep -Seconds 1
            $expo.Refresh()
            $loopback.Refresh()
        }
        if (-not (Test-Path -LiteralPath $script:StatePath)) {
            Write-Host 'Launcher stopped by Stop/Clean.'
            return
        }
        if ($expo.HasExited) { throw "Expo exited unexpectedly with code $($expo.ExitCode)." }
        if ($loopback.HasExited) { throw "Synthetic loopback exited unexpectedly with code $($loopback.ExitCode)." }
    } finally {
        if (Test-Path -LiteralPath $script:StatePath) {
            Stop-StateProcesses
        }
    }
}

function Clean-Demo {
    Stop-StateProcesses
    if (Test-Path -LiteralPath $script:TempRoot) {
        $safeTemp = Assert-PathUnderTemp (Join-Path $script:TempRoot '.')
        Remove-Item -LiteralPath $safeTemp -Recurse -Force
    }
    Write-Host 'Demo temp directory cleaned.'
}

function Export-Demo {
    Assert-Repository
    Assert-Dependencies
    $node = Get-NodePath
    $expoCli = Join-Path $script:RepoRoot 'node_modules\expo\bin\cli'
    $target = Assert-PathUnderTemp (Join-Path $script:TempRoot $ExportName)
    New-Item -ItemType Directory -Force -Path $script:TempRoot | Out-Null
    if (Test-Path -LiteralPath $target) {
        Remove-Item -LiteralPath $target -Recurse -Force
    }

    $stdout = Join-Path $script:TempRoot 'export.stdout.log'
    $stderr = Join-Path $script:TempRoot 'export.stderr.log'
    $process = Start-Process -FilePath $node -ArgumentList @(
        $expoCli, 'export', '--platform', 'web', '--output-dir', $target
    ) -WorkingDirectory $script:RepoRoot -NoNewWindow -PassThru -Wait `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Environment (Get-DemoEnvironment)
    if ($process.ExitCode -ne 0) {
        throw "Expo export failed with code $($process.ExitCode). See $stderr"
    }

    $html = @(Get-ChildItem -LiteralPath $target -Recurse -File -Filter '*.html')
    $javascript = @(Get-ChildItem -LiteralPath $target -Recurse -File -Filter '*.js' | Sort-Object Length -Descending)
    if ($html.Count -eq 0 -or $javascript.Count -eq 0 -or $javascript[0].Length -le 800) {
        throw 'Export did not contain real HTML and JavaScript assets.'
    }
    Write-Host "Export ready: $target"
    Write-Host "HTML files: $($html.Count); largest JavaScript asset: $($javascript[0].Length) bytes"
}

switch ($Action) {
    'Start' { Start-Demo }
    'Stop' {
        Assert-Repository
        Stop-StateProcesses
    }
    'Clean' {
        Assert-Repository
        Clean-Demo
    }
    'Export' { Export-Demo }
}
