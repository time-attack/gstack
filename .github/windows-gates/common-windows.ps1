Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-IsolatedPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$AllowedRoot
  )
  $full = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd('\') + '\'
  if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    throw "path escaped isolated root: $full (root $root)"
  }
  return $full
}

function Convert-NativeToMsys {
  param([Parameter(Mandatory = $true)][string]$Path)
  $full = [IO.Path]::GetFullPath($Path)
  if ($full -notmatch '^([A-Za-z]):\\(.*)$') {
    throw "cannot convert non-drive path to MSYS form: $full"
  }
  $drive = $Matches[1].ToLowerInvariant()
  $tail = $Matches[2].Replace('\', '/')
  return "/$drive/$tail"
}

function New-SafeWindowsEnvironment {
  param(
    [Parameter(Mandatory = $true)][string]$IsolatedHome,
    [Parameter(Mandatory = $true)][string]$Temp,
    [string[]]$AdditionalPath = @(),
    [hashtable]$Additional = @{}
  )
  [IO.Directory]::CreateDirectory($IsolatedHome) | Out-Null
  [IO.Directory]::CreateDirectory($Temp) | Out-Null
  $appData = Join-Path $IsolatedHome 'AppData\Roaming'
  $localAppData = Join-Path $IsolatedHome 'AppData\Local'
  [IO.Directory]::CreateDirectory($appData) | Out-Null
  [IO.Directory]::CreateDirectory($localAppData) | Out-Null
  $pathParts = [Collections.Generic.List[string]]::new()
  foreach ($candidate in $AdditionalPath) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
      $pathParts.Add([IO.Path]::GetFullPath($candidate))
    }
  }
  foreach ($tool in @('bun.exe', 'node.exe', 'python3.exe', 'python.exe', 'pwsh.exe', 'git.exe')) {
    $command = Get-Command $tool -ErrorAction SilentlyContinue
    if ($null -ne $command) {
      $pathParts.Add([IO.Path]::GetDirectoryName($command.Source))
    }
  }
  foreach ($candidate in @(
    'C:\Program Files\Git\cmd',
    'C:\Program Files\Git\bin',
    'C:\Program Files\Git\usr\bin',
    (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0'),
    (Join-Path $env:SystemRoot 'System32'),
    $env:SystemRoot
  )) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate)) {
      $pathParts.Add([IO.Path]::GetFullPath($candidate))
    }
  }
  $safePath = (($pathParts | Select-Object -Unique) -join ';')
  $environment = @{
    SystemRoot = $env:SystemRoot
    WINDIR = $env:SystemRoot
    SystemDrive = $env:SystemDrive
    ComSpec = (Join-Path $env:SystemRoot 'System32\cmd.exe')
    OS = 'Windows_NT'
    PATHEXT = '.COM;.EXE;.BAT;.CMD'
    PROCESSOR_ARCHITECTURE = $env:PROCESSOR_ARCHITECTURE
    NUMBER_OF_PROCESSORS = $env:NUMBER_OF_PROCESSORS
    ProgramFiles = [Environment]::GetEnvironmentVariable('ProgramFiles')
    'ProgramFiles(x86)' = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    ProgramW6432 = [Environment]::GetEnvironmentVariable('ProgramW6432')
    HOME = $IsolatedHome
    USERPROFILE = $IsolatedHome
    APPDATA = $appData
    LOCALAPPDATA = $localAppData
    TEMP = $Temp
    TMP = $Temp
    PATH = $safePath
    CI = '1'
    NO_COLOR = '1'
    LANG = 'C.UTF-8'
  }
  foreach ($key in $Additional.Keys) {
    $environment[[string]$key] = [string]$Additional[$key]
  }
  return $environment
}

function Assert-SafeChildEnvironment {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Environment,
    [string]$EvidencePath
  )
  $forbiddenNames = @(
    '^(GITHUB_|ACTIONS_|RUNNER_)',
    '^(AZURE_|AWS_|GOOGLE_|GCLOUD_)',
    'SYSTEM_ACCESSTOKEN',
    '(TOKEN|SECRET|PASSWORD|CREDENTIAL|PROXY|OIDC|UPLOAD_URL|SERVER_URL|API_URL)'
  )
  foreach ($key in $Environment.Keys) {
    foreach ($pattern in $forbiddenNames) {
      if ([string]$key -match $pattern) {
        throw "forbidden cloud/credential/proxy environment key: $key"
      }
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($EvidencePath)) {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($EvidencePath)) | Out-Null
    $record = [ordered]@{
      inherited = $false
      forbiddenKeyCount = 0
      keys = @($Environment.Keys | Sort-Object)
      valuesLogged = $false
    }
    [IO.File]::WriteAllText($EvidencePath, (($record | ConvertTo-Json -Depth 6) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  }
}

function Invoke-LoggedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$StdoutPath,
    [Parameter(Mandatory = $true)][string]$StderrPath,
    [Parameter(Mandatory = $true)][hashtable]$Environment
  )
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($StdoutPath)) | Out-Null
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($StderrPath)) | Out-Null
  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.FileName = $FilePath
  $psi.WorkingDirectory = $WorkingDirectory
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  foreach ($argument in $Arguments) {
    $psi.ArgumentList.Add($argument)
  }
  Assert-SafeChildEnvironment -Environment $Environment
  $psi.Environment.Clear()
  foreach ($key in $Environment.Keys) {
    $psi.Environment[[string]$key] = [string]$Environment[$key]
  }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $psi
  $startedAt = [DateTime]::UtcNow
  if (-not $process.Start()) {
    throw "failed to start fixed process: $FilePath"
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  [IO.File]::WriteAllText($StdoutPath, $stdout, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($StderrPath, $stderr, [Text.UTF8Encoding]::new($false))
  return [pscustomobject]@{
    ExitCode = $process.ExitCode
    StartedAt = $startedAt.ToString('o')
    DurationMs = [Math]::Round(([DateTime]::UtcNow - $startedAt).TotalMilliseconds)
    StdoutPath = $StdoutPath
    StderrPath = $StderrPath
    StdoutSha256 = (Get-FileHash -LiteralPath $StdoutPath -Algorithm SHA256).Hash.ToLowerInvariant()
    StderrSha256 = (Get-FileHash -LiteralPath $StderrPath -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Materialize-ExactSource {
  param(
    [Parameter(Mandatory = $true)][string]$Bundle,
    [Parameter(Mandatory = $true)][string]$Sha,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][string]$EvidenceDirectory
  )
  if (Test-Path -LiteralPath $Destination) {
    throw "refusing to overwrite source destination: $Destination"
  }
  [IO.Directory]::CreateDirectory($EvidenceDirectory) | Out-Null
  $git = (Get-Command git.exe -ErrorAction Stop).Source
  $parent = [IO.Path]::GetDirectoryName($Destination)
  [IO.Directory]::CreateDirectory($parent) | Out-Null
  $toolHome = Join-Path $EvidenceDirectory 'tool-home'
  $toolTemp = Join-Path $EvidenceDirectory 'tool-temp'
  $gitEnvironment = New-SafeWindowsEnvironment -IsolatedHome $toolHome -Temp $toolTemp
  Assert-SafeChildEnvironment -Environment $gitEnvironment -EvidencePath (Join-Path $EvidenceDirectory 'child-environment.json')
  $clone = Invoke-LoggedProcess -FilePath $git -Arguments @('clone', '--no-checkout', $Bundle, $Destination) -WorkingDirectory $parent -StdoutPath (Join-Path $EvidenceDirectory 'git-clone.stdout.log') -StderrPath (Join-Path $EvidenceDirectory 'git-clone.stderr.log') -Environment $gitEnvironment
  if ($clone.ExitCode -ne 0) { throw "bundle clone failed with $($clone.ExitCode)" }
  $checkout = Invoke-LoggedProcess -FilePath $git -Arguments @('-C', $Destination, 'checkout', '--detach', $Sha) -WorkingDirectory $Destination -StdoutPath (Join-Path $EvidenceDirectory 'git-checkout.stdout.log') -StderrPath (Join-Path $EvidenceDirectory 'git-checkout.stderr.log') -Environment $gitEnvironment
  if ($checkout.ExitCode -ne 0) { throw "exact checkout failed with $($checkout.ExitCode)" }
  $verify = Invoke-LoggedProcess -FilePath $git -Arguments @('-C', $Destination, 'bundle', 'verify', $Bundle) -WorkingDirectory $Destination -StdoutPath (Join-Path $EvidenceDirectory 'git-bundle-verify.stdout.log') -StderrPath (Join-Path $EvidenceDirectory 'git-bundle-verify.stderr.log') -Environment $gitEnvironment
  if ($verify.ExitCode -ne 0) { throw "bundle verification failed with $($verify.ExitCode)" }
  $fsck = Invoke-LoggedProcess -FilePath $git -Arguments @('-C', $Destination, 'fsck', '--full') -WorkingDirectory $Destination -StdoutPath (Join-Path $EvidenceDirectory 'git-fsck.stdout.log') -StderrPath (Join-Path $EvidenceDirectory 'git-fsck.stderr.log') -Environment $gitEnvironment
  if ($fsck.ExitCode -ne 0) { throw "git fsck failed with $($fsck.ExitCode)" }
  $objects = Invoke-LoggedProcess -FilePath $git -Arguments @('-C', $Destination, 'rev-list', '--objects', '--all', '--missing=print') -WorkingDirectory $Destination -StdoutPath (Join-Path $EvidenceDirectory 'git-rev-list.stdout.log') -StderrPath (Join-Path $EvidenceDirectory 'git-rev-list.stderr.log') -Environment $gitEnvironment
  if ($objects.ExitCode -ne 0) { throw "git object scan failed with $($objects.ExitCode)" }
  $missing = Select-String -LiteralPath $objects.StdoutPath -Pattern '^\?' -AllMatches
  if ($null -ne $missing) { throw 'bundle checkout has missing Git objects' }
  $headResult = Invoke-LoggedProcess -FilePath $git -Arguments @('-C', $Destination, 'rev-parse', 'HEAD') -WorkingDirectory $Destination -StdoutPath (Join-Path $EvidenceDirectory 'git-head.stdout.log') -StderrPath (Join-Path $EvidenceDirectory 'git-head.stderr.log') -Environment $gitEnvironment
  if ($headResult.ExitCode -ne 0) { throw 'git HEAD probe failed' }
  $shallowResult = Invoke-LoggedProcess -FilePath $git -Arguments @('-C', $Destination, 'rev-parse', '--is-shallow-repository') -WorkingDirectory $Destination -StdoutPath (Join-Path $EvidenceDirectory 'git-shallow.stdout.log') -StderrPath (Join-Path $EvidenceDirectory 'git-shallow.stderr.log') -Environment $gitEnvironment
  if ($shallowResult.ExitCode -ne 0) { throw 'git shallow probe failed' }
  $actual = [IO.File]::ReadAllText($headResult.StdoutPath).Trim()
  $shallow = [IO.File]::ReadAllText($shallowResult.StdoutPath).Trim()
  if ($actual -ne $Sha) { throw "wrong exact checkout: expected $Sha got $actual" }
  if ($shallow -ne 'false') { throw "exact checkout is shallow: $Destination" }
  $record = [ordered]@{
    expectedSha = $Sha
    actualSha = $actual
    shallow = $false
    missingObjectCount = 0
    bundle = $Bundle
    bundleSha256 = (Get-FileHash -LiteralPath $Bundle -Algorithm SHA256).Hash.ToLowerInvariant()
    destination = $Destination
  }
  [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'source-invariant.json'), (($record | ConvertTo-Json -Depth 5) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
  return $record
}

function Enter-TestNetworkLockdown {
  param([Parameter(Mandatory = $true)][string]$EvidenceDirectory)
  [IO.Directory]::CreateDirectory($EvidenceDirectory) | Out-Null
  $ruleName = "gstack-windows-gate-$PID-$([Guid]::NewGuid().ToString('N'))"
  $remoteRanges = @('0.0.0.0-126.255.255.255', '128.0.0.0-255.255.255.255', '::/0')
  try {
    New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Direction Outbound -Action Block -Enabled True -Profile Any -RemoteAddress $remoteRanges | Out-Null
    $rule = Get-NetFirewallRule -Name $ruleName -ErrorAction Stop
    if ($rule.Enabled -ne 'True' -or $rule.Action -ne 'Block' -or $rule.Direction -ne 'Outbound') {
      throw 'failed to establish outbound network lockdown'
    }
    $record = [ordered]@{
      ruleName = $ruleName
      action = 'Block'
      direction = 'Outbound'
      blockedRemoteRanges = $remoteRanges
      allowedLoopback = '127.0.0.0/8 only'
      createdAt = [DateTime]::UtcNow.ToString('o')
    }
    [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'network-lockdown.json'), (($record | ConvertTo-Json -Depth 5) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
    return $ruleName
  } catch {
    $original = $_
    $existing = Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
      Remove-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue
    }
    if ($null -ne (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue)) {
      throw "network lockdown setup failed and emergency cleanup also failed: $($original.Exception.Message)"
    }
    throw $original
  }
}

function Exit-TestNetworkLockdown {
  param(
    [Parameter(Mandatory = $true)][string]$RuleName,
    [Parameter(Mandatory = $true)][string]$EvidenceDirectory
  )
  Remove-NetFirewallRule -Name $RuleName -ErrorAction Stop
  if ($null -ne (Get-NetFirewallRule -Name $RuleName -ErrorAction SilentlyContinue)) {
    throw "failed to remove network lockdown rule: $RuleName"
  }
  [IO.File]::WriteAllText((Join-Path $EvidenceDirectory 'network-restored.json'), (([ordered]@{ ruleName = $RuleName; removed = $true; restoredAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Depth 3) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
}

function Write-ArtifactHashManifest {
  param(
    [Parameter(Mandatory = $true)][string]$ArtifactRoot,
    [Parameter(Mandatory = $true)][string]$OutputPath
  )
  $outputFull = [IO.Path]::GetFullPath($OutputPath)
  $rows = @(
    Get-ChildItem -LiteralPath $ArtifactRoot -File -Recurse |
      Where-Object { [IO.Path]::GetFullPath($_.FullName) -ne $outputFull } |
      Sort-Object FullName |
      ForEach-Object {
        [ordered]@{
          path = [IO.Path]::GetRelativePath($ArtifactRoot, $_.FullName).Replace('\', '/')
          bytes = $_.Length
          sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
      }
  )
  [IO.File]::WriteAllText($OutputPath, (([ordered]@{ schemaVersion = 1; files = $rows } | ConvertTo-Json -Depth 6) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
}

function Get-ModelOverlayFailureIdentity {
  param(
    [Parameter(Mandatory = $true)][System.Collections.IDictionary]$PhaseResult,
    [Parameter(Mandatory = $true)][string]$ArtifactRoot
  )
  foreach ($requiredKey in @('phase', 'repo')) {
    if (-not $PhaseResult.Contains($requiredKey)) { throw "failure identity input omitted $requiredKey" }
  }
  $phaseRoot = [IO.Path]::GetDirectoryName([string]$PhaseResult.repo)
  $stdoutPath = Join-Path $ArtifactRoot (Join-Path ([string]$PhaseResult.phase) 'test-windows.stdout.log')
  $stderrPath = Join-Path $ArtifactRoot (Join-Path ([string]$PhaseResult.phase) 'test-windows.stderr.log')
  $combined = [IO.File]::ReadAllText($stdoutPath) + [Environment]::NewLine + [IO.File]::ReadAllText($stderrPath)
  $lines = @(
    $combined -split '\r?\n' |
      Where-Object { $_ -match '(?i)(\(fail\)|\bfailed\b|^error:|^not ok\b|assertion.*error)' } |
      ForEach-Object {
        $_.Replace($phaseRoot, '<PHASE_ROOT>') -replace '\[[0-9.]+\s*(ms|s)\]', '[duration]' -replace '\\', '/'
      } |
      Where-Object { $_ -notmatch '^\s*0\s+fail' }
  )
  $canonical = ($lines -join [Environment]::NewLine)
  $hash = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($canonical))).ToLowerInvariant()
  return [ordered]@{ count = $lines.Count; sha256 = $hash; lines = $lines }
}
