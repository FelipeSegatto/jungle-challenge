# Run from PowerShell in project root with docker compose up -d --build
$api = 'http://localhost:3001'
$playerId = [guid]::NewGuid().ToString()
$walletJson = @{playerId=$playerId;initialBalance=@{amount='100.00';currency='BRL'}} | ConvertTo-Json -Depth 5
$wallet = Invoke-RestMethod -Method Post -Uri "$api/wallets" -ContentType 'application/json' -Body $walletJson
Write-Host "Wallet criada: $($wallet.id)"
$bet = @{providerId='provider-a';externalTransactionId=([guid]::NewGuid().ToString());playerId=$playerId;walletId=$wallet.id;roundId='round-a';gameId='fortune-chimp';kind='BET';money=@{amount='25.00';currency='BRL'}}
$key = "provider-a:$($bet.externalTransactionId)"
$json = $bet | ConvertTo-Json -Depth 5
$result = Invoke-RestMethod -Method Post -Uri "$api/wagering/transactions" -Headers @{'Idempotency-Key'=$key} -ContentType 'application/json' -Body $json
Write-Host "BET: $($result.status) - saldo: $($result.balance.amount)"
$replay = Invoke-RestMethod -Method Post -Uri "$api/wagering/transactions" -Headers @{'Idempotency-Key'=$key} -ContentType 'application/json' -Body $json
Write-Host "Replay: $($replay.idempotentReplay) - saldo original: $($replay.balance.amount)"
$check = Invoke-RestMethod -Method Post -Uri "$api/wallets/$($wallet.id)/reconciliation"
Write-Host "Reconciliado: $($check.consistent) - diferenca: $($check.difference.amount)"
if (!$check.consistent -or $result.balance.amount -ne '75.00' -or !$replay.idempotentReplay) { throw 'DEMO_FAILED' }
Write-Host 'DEMO PASSOU' -ForegroundColor Green
