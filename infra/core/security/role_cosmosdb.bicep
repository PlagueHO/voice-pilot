metadata description = 'Creates data plane role assignments on an Azure Cosmos DB account.'

// TODO: Once this proposal is implemented: https://github.com/azure/bicep/issues/2245
// We can create a generalized version of this resource that can be used any resource
// by passing in the resource as a parameter.

import { roleAssignmentType } from 'br/public:avm/utl/types/avm-common-types:0.5.1'

@sys.description('Optional. Array of data plane role assignments to create.')
param roleAssignments roleAssignmentType[]?

@sys.description('The name of the Azure Cosmos DB account to set the data plane role assignments on.')
param cosmosDbAccountName string

resource cosmosDbAccount 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' existing = {
  name: cosmosDbAccountName
}

var builtInDataPlaneRoleNames = {
  'Cosmos DB Built-in Data Contributor': '00000000-0000-0000-0000-000000000002'
  'Cosmos DB Built-in Data Reader': '00000000-0000-0000-0000-000000000001'
}

var formattedRoleAssignments = [
  for (roleAssignment, index) in (roleAssignments ?? []): union(roleAssignment, {
    roleDefinitionId: contains(builtInDataPlaneRoleNames, roleAssignment.roleDefinitionIdOrName)
      ? '${cosmosDbAccount.id}/sqlRoleDefinitions/${builtInDataPlaneRoleNames[roleAssignment.roleDefinitionIdOrName]}'
      : (contains(roleAssignment.roleDefinitionIdOrName, '/sqlRoleDefinitions/')
          ? roleAssignment.roleDefinitionIdOrName
          : '${cosmosDbAccount.id}/sqlRoleDefinitions/${roleAssignment.roleDefinitionIdOrName}')
  })
]

resource cosmosDb_dataPlaneRoleAssignments 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = [
  for (roleAssignment, index) in (formattedRoleAssignments ?? []): {
    name: roleAssignment.?name ?? guid(roleAssignment.roleDefinitionId, roleAssignment.principalId, cosmosDbAccount.id)
    parent: cosmosDbAccount
    properties: {
      principalId: roleAssignment.principalId
      roleDefinitionId: roleAssignment.roleDefinitionId
      scope: cosmosDbAccount.id
    }
  }
]

@sys.description('The resource IDs of the created data plane role assignments.')
output roleAssignmentResourceIds string[] = [
  for (roleAssignment, index) in (formattedRoleAssignments ?? []): cosmosDb_dataPlaneRoleAssignments[index].id
]
