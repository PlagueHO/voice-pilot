#!/usr/bin/env bash
# Simple GPT Realtime smoke test that verifies the deployed Azure AI Foundry account and model deployment.
set -euo pipefail

required_env=(
  "AZURE_SUBSCRIPTION_ID"
  "AZURE_RESOURCE_GROUP"
  "AZURE_AI_FOUNDRY_NAME"
)

for var_name in "${required_env[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required environment variable: ${var_name}" >&2
    exit 1
  fi
done

az account set --subscription "${AZURE_SUBSCRIPTION_ID}" >/dev/null

account_state=$(az cognitiveservices account show \
  --name "${AZURE_AI_FOUNDRY_NAME}" \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --query "properties.provisioningState" \
  --output tsv)

if [[ "${account_state}" != "Succeeded" ]]; then
  echo "Azure AI Foundry account is not in Succeeded state (current: ${account_state})." >&2
  exit 1
fi

deployment_state=$(az cognitiveservices account deployment show \
  --name "${AZURE_AI_FOUNDRY_NAME}" \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --deployment-name "gpt-realtime" \
  --query "properties.provisioningState" \
  --output tsv 2>/dev/null || true)

if [[ -z "${deployment_state}" ]]; then
  echo "GPT Realtime deployment not found on Azure AI Foundry account." >&2
  exit 1
fi

if [[ "${deployment_state}" != "Succeeded" ]]; then
  echo "GPT Realtime deployment is not ready (state: ${deployment_state})." >&2
  exit 1
fi

model_name=$(az cognitiveservices account deployment show \
  --name "${AZURE_AI_FOUNDRY_NAME}" \
  --resource-group "${AZURE_RESOURCE_GROUP}" \
  --deployment-name "gpt-realtime" \
  --query "properties.model.name" \
  --output tsv)

if [[ "${model_name}" != "gpt-realtime" ]]; then
  echo "Unexpected model deployed: ${model_name}" >&2
  exit 1
fi

echo "✅ Azure AI Foundry and GPT Realtime deployment verified successfully."
