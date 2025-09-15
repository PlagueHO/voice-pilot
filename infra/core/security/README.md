# Cosmos DB Data Plane Role Assignment Module

This Bicep module creates data plane role assignments on an Azure Cosmos DB account, following the same pattern as the `role_aisearch.bicep` module.

## Supported Built-in Data Plane Roles

- **Cosmos DB Built-in Data Contributor** (`00000000-0000-0000-0000-000000000002`) - Full read/write access to data
- **Cosmos DB Built-in Data Reader** (`00000000-0000-0000-0000-000000000001`) - Read-only access to data

## Parameters

- `cosmosDbAccountName` (string, required) - The name of the existing Azure Cosmos DB account
- `roleAssignments` (array, optional) - Array of role assignments following the AVM roleAssignmentType

## Usage Example

```bicep
// Example usage of the Cosmos DB data plane role assignment module
module cosmosDbRoleAssignments './core/security/role_cosmosdb.bicep' = {
  name: 'cosmos-db-role-assignments'
  scope: resourceGroup('my-resource-group')
  params: {
    cosmosDbAccountName: 'my-cosmosdb-account'
    roleAssignments: [
      {
        roleDefinitionIdOrName: 'Cosmos DB Built-in Data Contributor'
        principalType: 'User'
        principalId: '12345678-1234-1234-1234-123456789012' // User object ID
      }
      {
        roleDefinitionIdOrName: 'Cosmos DB Built-in Data Reader'
        principalType: 'ServicePrincipal'
        principalId: '87654321-4321-4321-4321-210987654321' // Managed Identity object ID
      }
      {
        roleDefinitionIdOrName: '00000000-0000-0000-0000-000000000002' // Direct role definition ID
        principalType: 'User'
        principalId: 'abcdef12-3456-7890-abcd-ef1234567890'
      }
    ]
  }
}
```

## Integration with Main Infrastructure

The module is designed to work with the main infrastructure deployment and supports conditional deployment:

```bicep
// Define role assignments array conditionally
var cosmosDbDataPlaneRoleAssignmentsArray = [
  ...(!empty(principalId) ? [
    {
      roleDefinitionIdOrName: 'Cosmos DB Built-in Data Contributor'
      principalType: principalIdType
      principalId: principalId
    }
  ] : [])
]

// Deploy role assignments only when Cosmos DB is deployed
module cosmosDbDataPlaneRoleAssignments './core/security/role_cosmosdb.bicep' = if (cosmosDbDeploy) {
  name: 'cosmos-db-dataplane-role-assignments-${resourceToken}'
  scope: az.resourceGroup(resourceGroupName)
  dependsOn: [
    rg
    cosmosDbAccount
  ]
  params: {
    cosmosDbAccountName: cosmosDbAccountName
    roleAssignments: cosmosDbDataPlaneRoleAssignmentsArray
  }
}
```

## Key Features

1. **Built-in Role Support**: Automatically maps friendly role names to their GUIDs
2. **Direct GUID Support**: Accepts role definition GUIDs directly for custom roles
3. **Full Path Support**: Accepts complete role definition resource IDs
4. **AVM Compliance**: Uses the standard AVM roleAssignmentType interface
5. **Conditional Deployment**: Integrates with feature flags for optional deployment

## Notes

- Data plane role assignments in Cosmos DB are different from control plane (Azure RBAC) roles
- The module automatically constructs the correct role definition resource ID format
- Role assignments are scoped to the entire Cosmos DB account
- Requires the Cosmos DB account to exist before creating role assignments
