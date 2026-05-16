@description('Base name for all resources')
param appName string = 'helloworld'

@description('Azure region')
param location string = resourceGroup().location

@description('Origin of the Static Web App (filled after first deploy)')
param staticWebAppUrl string = ''

// App Service Plan (Linux, Free tier for dev / change to B1+ for prod)
resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: '${appName}-plan'
  location: location
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

// App Service — .NET backend
resource appService 'Microsoft.Web/sites@2023-01-01' = {
  name: '${appName}-api'
  location: location
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      appSettings: [
        {
          name: 'AllowedOrigins__0'
          value: staticWebAppUrl
        }
      ]
    }
    httpsOnly: true
  }
}

// Static Web App — Angular frontend
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: '${appName}-web'
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

output apiUrl string = 'https://${appService.properties.defaultHostName}'
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output staticWebAppApiKey string = staticWebApp.listSecrets().properties.apiKey
