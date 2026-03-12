# Download missing server/models from Mintplex-Labs/anything-llm (master)
$baseUrl = "https://raw.githubusercontent.com/Mintplex-Labs/anything-llm/master/server/models"
$modelsDir = Join-Path $PSScriptRoot "..\server\models"
$files = @(
    "apiKeys.js", "browserExtensionApiKey.js", "cacheData.js", "communityHub.js",
    "documentSyncQueue.js", "documentSyncRun.js", "documents.js", "embedChats.js",
    "embedConfig.js", "eventLogs.js", "invite.js", "mobileDevice.js", "passwordRecovery.js",
    "promptHistory.js", "slashCommandsPresets.js", "systemPromptVariables.js", "systemSettings.js",
    "telemetry.js", "temporaryAuthToken.js", "user.js", "vectors.js", "welcomeMessages.js",
    "workspace.js", "workspaceAgentInvocation.js", "workspaceChats.js", "workspaceParsedFiles.js",
    "workspaceThread.js", "workspaceUsers.js", "workspacesSuggestedMessages.js"
)

if (-not (Test-Path $modelsDir)) { New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null }
foreach ($f in $files) {
    $url = "$baseUrl/$f"
    $out = Join-Path $modelsDir $f
    try {
        Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
        Write-Host "OK: $f"
    } catch {
        Write-Host "FAIL: $f - $_"
    }
}
Write-Host "Done. Run: set SERVER_PORT=4101 && yarn dev:server"
