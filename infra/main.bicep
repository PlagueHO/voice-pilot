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

var aiFoundryName = '${abbrs.aiFoundryAccounts}${environmentName}'
var aiFoundryCustomSubDomainName = toLower(replace(environmentName, '-', ''))

// Use the Azure AI Foundry models directly from JSON - they're already in the correct format for the AVM module
var azureAiFoundryModelDeployments = azureAiFoundryModels

// The application resources that are deployed into the application resource group
module rg 'br/public:avm/res/resources/resource-group:0.4.1' = {
  name: 'resource-group-deployment-${resourceToken}'
  params: {
    name: resourceGroupName
    location: location
    tags: tags
  }
}

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
    disableLocalAuth: false
    allowProjectManagement: true
    managedIdentities: {
      systemAssigned: true
    }
    publicNetworkAccess: 'Enabled'
    sku: 'S0'
    deployments: azureAiFoundryModelDeployments
    tags: tags
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

// Outputs
output AZURE_RESOURCE_GROUP string = rg.outputs.name
output AZURE_PRINCIPAL_ID string = principalId
output AZURE_PRINCIPAL_ID_TYPE string = principalIdType

// Output the AI Foundry resources
output AZURE_AI_FOUNDRY_NAME string = aiFoundryService.outputs.name
output AZURE_AI_FOUNDRY_ID string = aiFoundryService.outputs.resourceId
output AZURE_AI_FOUNDRY_ENDPOINT string = aiFoundryService.outputs.endpoint
output AZURE_AI_FOUNDRY_RESOURCE_ID string = aiFoundryService.outputs.resourceId
