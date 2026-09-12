$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'wrangler' }
foreach ($p in $procs) {
  $cmd = $p.CommandLine
  if ($cmd.Length -gt 140) { $cmd = $cmd.Substring(0, 140) }
  Write-Output ("PID {0}: {1}" -f $p.ProcessId, $cmd)
}
