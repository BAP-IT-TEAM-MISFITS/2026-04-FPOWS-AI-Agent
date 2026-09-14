# =============================================================================
# FPOWS — Deploy to Google Cloud Run as a CONTAINER IMAGE
# =============================================================================
# Flow: build Docker image -> push to Artifact Registry -> deploy image to
# Cloud Run (deployment type = image/container, NOT --source).
#
# Requires: gcloud CLI (authenticated) and a filled-in .env.
# Docker is used if available; otherwise the build falls back to Cloud Build.
# =============================================================================

$ErrorActionPreference = "Stop"

# This script lives in <repo>/deploy, so the repo root (build context + .env) is
# one level up.
$RepoRoot = Split-Path $PSScriptRoot -Parent

# --- Target configuration ----------------------------------------------------
$PROJECT_ID   = "fpows-500123"
$SERVICE_NAME = "bryan-fpows"
$REGION       = "australia-southeast1"
$REPO         = "fpows"                       # Artifact Registry repository name
$REGISTRY     = "$REGION-docker.pkg.dev"
$IMAGE        = "$REGISTRY/$PROJECT_ID/$REPO/$SERVICE_NAME"

# Image tag: git short SHA when available, else a timestamp. Also tag :latest.
$TAG = (git rev-parse --short HEAD 2>$null)
if (-not $TAG) { $TAG = Get-Date -Format "yyyyMMdd-HHmmss" }
$IMAGE_TAGGED = "${IMAGE}:${TAG}"
$IMAGE_LATEST = "${IMAGE}:latest"

# --- Load credentials from local .env (never commit credentials here) --------
$envFile = Join-Path $RepoRoot ".env"
if (-not (Test-Path $envFile)) {
    Write-Error ".env file not found. Cannot deploy without credentials."
    exit 1
}
Get-Content $envFile | ForEach-Object {
    if ($_ -match '^([^#=][^=]*)=(.+)$') {
        [System.Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process')
    }
}

$SMTP_USER            = $env:SMTP_USER
$SMTP_PASS            = $env:SMTP_PASS
$MANAGER_EMAIL        = $env:MANAGER_EMAIL
$SIMPRO_BASE_URL      = $env:SIMPRO_BASE_URL
$SIMPRO_ACCESS_TOKEN  = $env:SIMPRO_ACCESS_TOKEN
$SIMPRO_COMPANY_ID    = $env:SIMPRO_COMPANY_ID
$ADMIN_API_KEY        = $env:ADMIN_API_KEY
$GOOGLE_CLIENT_ID     = $env:GOOGLE_CLIENT_ID
$GOOGLE_CLIENT_SECRET = $env:GOOGLE_CLIENT_SECRET
$SESSION_SECRET       = $env:SESSION_SECRET

if (-not $SIMPRO_COMPANY_ID) { $SIMPRO_COMPANY_ID = "1" }

if (-not $SIMPRO_BASE_URL -or -not $SIMPRO_ACCESS_TOKEN -or -not $SMTP_PASS -or -not $ADMIN_API_KEY) {
    Write-Error "Missing required env vars in .env: SIMPRO_BASE_URL, SIMPRO_ACCESS_TOKEN, SMTP_PASS, ADMIN_API_KEY"
    exit 1
}
if (-not $GOOGLE_CLIENT_ID -or -not $GOOGLE_CLIENT_SECRET -or -not $SESSION_SECRET) {
    Write-Error "Missing OAuth env vars in .env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET"
    exit 1
}

# --- Enable required APIs (safe to run repeatedly) ---------------------------
Write-Host "==> Enabling required GCP APIs..." -ForegroundColor Cyan
gcloud services enable `
    artifactregistry.googleapis.com `
    run.googleapis.com `
    cloudbuild.googleapis.com `
    cloudscheduler.googleapis.com `
    --project $PROJECT_ID

# --- Ensure the Artifact Registry repository exists --------------------------
Write-Host "==> Ensuring Artifact Registry repo '$REPO' exists in $REGION..." -ForegroundColor Cyan
$repoExists = gcloud artifacts repositories describe $REPO `
    --location $REGION --project $PROJECT_ID --format "value(name)" 2>$null
if (-not $repoExists) {
    Write-Host "    Repository not found. Creating..." -ForegroundColor Yellow
    gcloud artifacts repositories create $REPO `
        --repository-format=docker `
        --location=$REGION `
        --project=$PROJECT_ID `
        --description="FPOWS container images"
}

# --- Build the image and push to Artifact Registry ---------------------------
$dockerAvailable = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)

if ($dockerAvailable) {
    Write-Host "==> Building image locally with Docker: $IMAGE_TAGGED" -ForegroundColor Cyan
    # Authenticate Docker to this Artifact Registry host (idempotent)
    gcloud auth configure-docker $REGISTRY --quiet

    docker build -t $IMAGE_TAGGED -t $IMAGE_LATEST $RepoRoot
    if ($LASTEXITCODE -ne 0) { Write-Error "docker build failed."; exit 1 }

    Write-Host "==> Pushing image to Artifact Registry..." -ForegroundColor Cyan
    docker push $IMAGE_TAGGED
    if ($LASTEXITCODE -ne 0) { Write-Error "docker push (tag) failed."; exit 1 }
    docker push $IMAGE_LATEST
    if ($LASTEXITCODE -ne 0) { Write-Error "docker push (latest) failed."; exit 1 }
}
else {
    Write-Host "==> Docker not found. Building with Cloud Build instead: $IMAGE_TAGGED" -ForegroundColor Yellow
    # Cloud Build reads the repo Dockerfile, builds, and pushes to Artifact Registry.
    gcloud builds submit --tag $IMAGE_TAGGED --project $PROJECT_ID $RepoRoot
    if ($LASTEXITCODE -ne 0) { Write-Error "Cloud Build submit failed."; exit 1 }
}

# --- Deploy the IMAGE to Cloud Run (not --source) ----------------------------
$envVars = "SMTP_USER=$SMTP_USER,SMTP_PASS=$SMTP_PASS,MANAGER_EMAIL=$MANAGER_EMAIL,SIMPRO_BASE_URL=$SIMPRO_BASE_URL,SIMPRO_ACCESS_TOKEN=$SIMPRO_ACCESS_TOKEN,SIMPRO_COMPANY_ID=$SIMPRO_COMPANY_ID,ADMIN_API_KEY=$ADMIN_API_KEY,GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET,SESSION_SECRET=$SESSION_SECRET"

Write-Host "==> Deploying image to Cloud Run service '$SERVICE_NAME'..." -ForegroundColor Cyan
gcloud run deploy $SERVICE_NAME `
    --image $IMAGE_TAGGED `
    --region $REGION `
    --project $PROJECT_ID `
    --allow-unauthenticated `
    --timeout=540 `
    --set-env-vars=$envVars
if ($LASTEXITCODE -ne 0) { Write-Error "Cloud Run deploy failed."; exit 1 }

# --- Fetch the deployed service URL ------------------------------------------
$SERVICE_URL = gcloud run services describe $SERVICE_NAME --region $REGION --project $PROJECT_ID --format "value(status.url)"
if (-not $SERVICE_URL) {
    Write-Error "Could not determine service URL after deploy."
    exit 1
}

# --- Create or update the 6am daily report scheduler -------------------------
$JOB_NAME    = "fpows-daily-report-6am"
$TRIGGER_URI = "$SERVICE_URL/api/trigger-manager-report?key=$ADMIN_API_KEY"

gcloud scheduler jobs delete $JOB_NAME --location $REGION --project $PROJECT_ID --quiet 2>$null

gcloud scheduler jobs create http $JOB_NAME `
    --schedule="0 6 * * *" `
    --time-zone="Asia/Manila" `
    --uri=$TRIGGER_URI `
    --http-method=GET `
    --attempt-deadline=540s `
    --location=$REGION `
    --project=$PROJECT_ID `
    --description="Daily FPOWS report at 6am Manila"

# --- Monitoring: uptime check + email alert (idempotent, NON-FATAL) ----------
# This whole block runs AFTER the service + scheduler are already live, and is
# wrapped so ANY failure here only warns - it can never fail or roll back the
# deployment that already succeeded above.
$UPTIME_NAME  = "fpows-health"
$UPTIME_HOST  = ($SERVICE_URL -replace '^https?://', '')
$CHANNEL_NAME = "FPOWS Alerts (email)"
$POLICY_NAME  = "FPOWS health check failing"
$alertSummary = "not configured"

try {
    # -- 1. Uptime check: pings /health every 5 min. /health returns 200 only
    #    when the simPRO + SMTP env vars are present (503 'degraded' otherwise),
    #    so a red check means the service is down or misconfigured. Re-running
    #    leaves an existing check untouched (uptime checks aren't keyed by name).
    $existingUptime = gcloud monitoring uptime list-configs `
        --project $PROJECT_ID `
        --filter="displayName='$UPTIME_NAME'" `
        --format="value(name)" 2>$null

    if ($existingUptime) {
        Write-Host "==> Uptime check '$UPTIME_NAME' already exists - leaving as is." -ForegroundColor Cyan
    }
    else {
        Write-Host "==> Creating uptime check '$UPTIME_NAME' against https://$UPTIME_HOST/health..." -ForegroundColor Cyan
        gcloud monitoring uptime create $UPTIME_NAME `
            --resource-type=uptime-url `
            --resource-labels=host=$UPTIME_HOST,project_id=$PROJECT_ID `
            --protocol=https `
            --path="/health" `
            --port=443 `
            --period=5 `
            --timeout=10 `
            --matcher-content="ok" `
            --matcher-type=contains-string `
            --project=$PROJECT_ID
    }

    # Fetch the config's resource name (works whether pre-existing or just made).
    # The metric label 'check_id' used by the alert filter is its last segment.
    $uptimeConfigName = gcloud monitoring uptime list-configs `
        --project $PROJECT_ID `
        --filter="displayName='$UPTIME_NAME'" `
        --format="value(name)" 2>$null
    $UPTIME_CHECK_ID = ($uptimeConfigName -split '/')[-1]

    # -- 2. Email alert policy: notifies when the uptime check fails. Needs a
    #    recipient; skip cleanly if MANAGER_EMAIL isn't set.
    if (-not $MANAGER_EMAIL) {
        Write-Warning "MANAGER_EMAIL not set - uptime check created, but skipping the email alert policy."
    }
    elseif (-not $UPTIME_CHECK_ID) {
        Write-Warning "Could not resolve the uptime check id - skipping the email alert policy."
    }
    else {
        # 2a. Email notification channel (idempotent by display name).
        $channel = gcloud beta monitoring channels list `
            --project $PROJECT_ID `
            --filter="displayName='$CHANNEL_NAME'" `
            --format="value(name)" 2>$null
        if (-not $channel) {
            Write-Host "==> Creating email notification channel -> $MANAGER_EMAIL" -ForegroundColor Cyan
            gcloud beta monitoring channels create `
                --project $PROJECT_ID `
                --type=email `
                --display-name="$CHANNEL_NAME" `
                --channel-labels=email_address=$MANAGER_EMAIL | Out-Null
            $channel = gcloud beta monitoring channels list `
                --project $PROJECT_ID `
                --filter="displayName='$CHANNEL_NAME'" `
                --format="value(name)" 2>$null
        }

        # 2b. Alert policy (idempotent by display name).
        $existingPolicy = gcloud monitoring policies list `
            --project $PROJECT_ID `
            --filter="displayName='$POLICY_NAME'" `
            --format="value(name)" 2>$null

        if ($existingPolicy) {
            Write-Host "==> Alert policy '$POLICY_NAME' already exists - leaving as is." -ForegroundColor Cyan
            $alertSummary = "$POLICY_NAME (existing) -> $MANAGER_EMAIL"
        }
        elseif (-not $channel) {
            Write-Warning "Notification channel unavailable - skipping the alert policy."
        }
        else {
            Write-Host "==> Creating alert policy '$POLICY_NAME'..." -ForegroundColor Cyan
            $policyJson = @"
{
  "displayName": "$POLICY_NAME",
  "combiner": "OR",
  "conditions": [
    {
      "displayName": "Uptime check failing",
      "conditionThreshold": {
        "filter": "resource.type = \"uptime_url\" AND metric.type = \"monitoring.googleapis.com/uptime_check/check_passed\" AND metric.label.check_id = \"$UPTIME_CHECK_ID\"",
        "aggregations": [
          {
            "alignmentPeriod": "300s",
            "perSeriesAligner": "ALIGN_NEXT_OLDER",
            "crossSeriesReducer": "REDUCE_COUNT_FALSE",
            "groupByFields": ["resource.label.host"]
          }
        ],
        "comparison": "COMPARISON_GT",
        "thresholdValue": 1,
        "duration": "300s",
        "trigger": { "count": 1 }
      }
    }
  ],
  "notificationChannels": ["$channel"],
  "alertStrategy": { "autoClose": "1800s" }
}
"@
            # Write UTF-8 WITHOUT BOM (gcloud's JSON parser rejects a BOM).
            $policyFile = Join-Path $env:TEMP "fpows-alert-policy.json"
            [System.IO.File]::WriteAllText($policyFile, $policyJson)
            gcloud monitoring policies create `
                --project $PROJECT_ID `
                --policy-from-file=$policyFile
            Remove-Item $policyFile -ErrorAction SilentlyContinue
            $alertSummary = "$POLICY_NAME -> $MANAGER_EMAIL"
        }
    }
}
catch {
    Write-Warning "Monitoring setup step failed (the deployment itself is UNAFFECTED): $($_.Exception.Message)"
}

Write-Host ""
Write-Host "Deployed image:   $IMAGE_TAGGED" -ForegroundColor Green
Write-Host "Service URL:      $SERVICE_URL" -ForegroundColor Green
Write-Host "Scheduler:        6:00 AM Asia/Manila -> $TRIGGER_URI"
Write-Host "Uptime check:     $UPTIME_NAME -> https://$UPTIME_HOST/health (every 5 min)"
Write-Host "Alert policy:     $alertSummary"
Write-Host "Report recipient: $MANAGER_EMAIL"
