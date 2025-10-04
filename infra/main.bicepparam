using './main.bicep'

// Required parameters
param environmentName = readEnvironmentVariable('AZURE_ENV_NAME', 'voice-pilot')
param location = readEnvironmentVariable('AZURE_LOCATION', 'EastUS2')

// User or service principal deploying the resources
param principalId = readEnvironmentVariable('AZURE_PRINCIPAL_ID', '')
param principalIdType = toLower(readEnvironmentVariable('AZURE_PRINCIPAL_ID_TYPE', 'user')) == 'serviceprincipal' ? 'ServicePrincipal' : 'User'

// Optional security hardening controls
param aiFoundryDisableLocalAuth = toLower(readEnvironmentVariable('AZURE_AI_FOUNDRY_DISABLE_LOCAL_AUTH', 'false')) == 'true'
param logAnalyticsRetentionInDays = int(readEnvironmentVariable('AZURE_LOG_ANALYTICS_RETENTION_DAYS', '14'))
