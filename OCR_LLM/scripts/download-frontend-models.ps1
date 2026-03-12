# Download missing frontend/src/models from Mintplex-Labs/anything-llm (master)
# Fixes 404 for /src/models/workspace etc. and blank chatbot page.
$baseUrl = "https://raw.githubusercontent.com/Mintplex-Labs/anything-llm/master/frontend/src/models"
$modelsDir = Join-Path $PSScriptRoot "..\frontend\src\models"

$files = @(
    "admin.js", "agentFlows.js", "appearance.js", "browserExtensionApiKey.js",
    "communityHub.js", "dataConnector.js", "document.js", "embed.js",
    "invite.js", "mcpServers.js", "mobile.js", "promptHistory.js",
    "system.js", "systemPromptVariable.js", "workspace.js", "workspaceThread.js",
    "utils/dmrUtils.js", "utils/lemonadeUtils.js",
    "experimental/agentPlugins.js", "experimental/liveSync.js"
)

foreach ($f in $files) {
    $url = "$baseUrl/$f"
    $out = Join-Path $modelsDir $f
    $outDir = Split-Path $out -Parent
    if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
    try {
        Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
        Write-Host "OK: $f"
    } catch {
        Write-Host "FAIL: $f - $_"
    }
}
Write-Host "Done. Restart Chatbot Frontend (3002) and reload http://localhost:3002"
