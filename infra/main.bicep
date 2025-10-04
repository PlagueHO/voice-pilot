targetScope = 'subscription'

@sys.description('Name of the the environment which is used to generate a short unique hash used in all resources.')
@minLength(1)
@maxLength(40)
param environmentName string

@sys.description('Location for all resources')
@minLength(1)
@metadata({
  azd: {
    type: 'location'
  }
})
param location string

@sys.description('The Azure resource group where new resources will be deployed.')
@metadata({
  azd: {
    type: 'resourceGroup'
  }
})
param resourceGroupName string = 'rg-${environmentName}'

@sys.description('Id of the user or app to assign application roles.')
param principalId string

@sys.description('Type of the principal referenced by principalId.')
@allowed([
  'User'
  'ServicePrincipal'
])
param principalIdType string = 'User'

@sys.description('Flag indicating whether local authentication should be disabled for the Azure AI Foundry account.')
param aiFoundryDisableLocalAuth bool = false

@sys.description('Number of days to retain diagnostics data in the Log Analytics workspace (must be 30 days or fewer for CI environments).')
@minValue(7)
@maxValue(30)
param logAnalyticsRetentionInDays int = 14

var abbrs = loadJsonContent('./abbreviations.json')
var azureAiFoundryModels = loadJsonContent('./azure-ai-foundry-models.json')

// tags that should be applied to all resources.
var tags = {
  // Tag all resources with the environment name.
  'azd-env-name': environmentName
  project: 'voice-pilot'
}

// Generate a unique token to be used in naming resources.
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))

var sanitizedEnvironmentName = toLower(replace(environmentName, '_', '-'))
var aiFoundryName = '${abbrs.aiFoundryAccounts}${environmentName}'
var aiFoundryCustomSubDomainName = toLower(replace(environmentName, '-', ''))
var logAnalyticsWorkspaceBaseName = '${abbrs.operationalInsightsWorkspaces}${sanitizedEnvironmentName}-${substring(resourceToken, 0, 6)}'
var logAnalyticsWorkspaceName = length(logAnalyticsWorkspaceBaseName) > 63
  ? substring(logAnalyticsWorkspaceBaseName, 0, 63)
  : logAnalyticsWorkspaceBaseName

// Use the Azure AI Foundry models directly from JSON - they're already in the correct format for the AVM module
var azureAiFoundryModelDeployments = [
  for (deployment, index) in azureAiFoundryModels: union(deployment, {
    name: take('${deployment.name}-${substring(resourceToken, 0, 6)}', 64)
  })
]

// The application resources that are deployed into the application resource group
module rg 'br/public:avm/res/resources/resource-group:0.4.1' = {
  name: 'resource-group-deployment-${resourceToken}'
  params: {
    name: resourceGroupName
    location: location
    tags: tags
  }
}

// --------- DIAGNOSTICS WORKSPACE ---------
module diagnosticsWorkspace 'br/public:avm/res/operational-insights/workspace:0.4.1' = {
  name: 'diagnostics-workspace-${resourceToken}'
  scope: resourceGroup(resourceGroupName)
  dependsOn: [
    rg
  ]
  params: {
    name: logAnalyticsWorkspaceName
    location: location
    skuName: 'PerGB2018'
    dataRetention: logAnalyticsRetentionInDays
    tags: tags
    roleAssignments: !empty(principalId) ? [
      {
        roleDefinitionIdOrName: 'Log Analytics Reader'
        principalType: principalIdType
        principalId: principalId
      }
    ] : []
  }
}

// --------- AI FOUNDRY DIAGNOSTICS ---------
var aiFoundryDiagnosticSettings = [
  {
    name: '${aiFoundryName}-diag'
    workspaceResourceId: diagnosticsWorkspace.outputs.resourceId
    logCategoriesAndGroups: [
      {
        categoryGroup: 'allLogs'
        enabled: true
      }
    ]
    metricCategories: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
]

// --------- AI FOUNDRY ---------
module aiFoundryService './cognitive-services/accounts/main.bicep' = {
  name: 'ai-foundry-service-deployment-${resourceToken}'
  scope: resourceGroup(resourceGroupName)
  dependsOn: [
    rg
  ]
  params: {
    name: aiFoundryName
    kind: 'AIServices'
    location: location
    customSubDomainName: aiFoundryCustomSubDomainName
    disableLocalAuth: aiFoundryDisableLocalAuth
    allowProjectManagement: true
    managedIdentities: {
      systemAssigned: true
    }
    publicNetworkAccess: 'Enabled'
    sku: 'S0'
    deployments: azureAiFoundryModelDeployments
    tags: tags
    diagnosticSettings: aiFoundryDiagnosticSettings
  }
}

// Role assignments for AI Foundry
var aiFoundryRoleAssignmentsArray = [
  // Developer role assignments
  ...(!empty(principalId) ? [
    {
      roleDefinitionIdOrName: 'Contributor'
      principalType: principalIdType
      principalId: principalId
    }
    {
      roleDefinitionIdOrName: 'Cognitive Services OpenAI Contributor'
      principalType: principalIdType
      principalId: principalId
    }
  ] : [])
]

module aiFoundryRoleAssignments './core/security/role_aifoundry.bicep' = {
  name: 'ai-foundry-role-assignments-${resourceToken}'
  scope: az.resourceGroup(resourceGroupName)
  dependsOn: [
    rg
    aiFoundryService
  ]
  params: {
    azureAiFoundryName: aiFoundryName
    roleAssignments: aiFoundryRoleAssignmentsArray
  }
}

// Subscription level diagnostic settings routing to Log Analytics workspace
resource subscriptionActivityLogs 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'activitylogs-${resourceToken}'
  properties: {
    workspaceId: diagnosticsWorkspace.outputs.resourceId
    logs: [
      {
        category: 'Administrative'
        enabled: true
      }
      {
        category: 'Policy'
        enabled: true
      }
    ]
    metrics: []
    logAnalyticsDestinationType: 'Dedicated'
  }
}

// Outputs
output AZURE_RESOURCE_GROUP string = rg.outputs.name
output AZURE_PRINCIPAL_ID string = principalId
output AZURE_PRINCIPAL_ID_TYPE string = principalIdType

// Output the AI Foundry resources
output AZURE_AI_FOUNDRY_NAME string = aiFoundryService.outputs.name
output AZURE_AI_FOUNDRY_ID string = aiFoundryService.outputs.resourceId
output AZURE_AI_FOUNDRY_ENDPOINT string = aiFoundryService.outputs.endpoint
output AZURE_AI_FOUNDRY_RESOURCE_ID string = aiFoundryService.outputs.resourceId
output LOG_ANALYTICS_WORKSPACE_NAME string = diagnosticsWorkspace.outputs.name
output LOG_ANALYTICS_RESOURCE_ID string = diagnosticsWorkspace.outputs.resourceId
output LOG_ANALYTICS_WORKSPACE_ID string = diagnosticsWorkspace.outputs.logAnalyticsWorkspaceId
