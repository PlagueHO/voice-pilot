@description('The project name of the Azure AI Foundry project to which the datastore will be added.')
param projectWorkspaceName string

@description('The name of the Azure Storage Account that contains the blob container.')
param storageAccountName string

@description('The name of the Azure Blob Container to be registered as a datastore.')
param storageContainerName string

@description('The name of the datastore to be created in the Azure AI Foundry project. Defaults to "ds-<storageContainerName>".')
param dataStoreName string

// Reference to the existing Azure AI Foundry project workspace
resource projectWorkspace 'Microsoft.MachineLearningServices/workspaces@2025-01-01-preview' existing = {
  name: projectWorkspaceName
}

// Datastore resource
resource dataStore 'Microsoft.MachineLearningServices/workspaces/datastores@2025-01-01-preview' = {
  parent: projectWorkspace
  name: dataStoreName
  properties: {
    accountName: storageAccountName
    containerName: storageContainerName
    datastoreType: 'AzureBlob' // Specifies the type of datastore
    endpoint: environment().suffixes.storage
    protocol: 'https'
    credentials: {
      credentialsType: 'None'
    }
    serviceDataAccessAuthIdentity: 'None'
  }
}

@description('The resource ID of the created datastore.')
output dataStoreResourceId string = dataStore.id

@description('The name of the created datastore.')
output dataStoreNameOutput string = dataStore.name
