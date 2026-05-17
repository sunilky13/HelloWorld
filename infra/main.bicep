@description('Base name for all resources')
param appName string = 'helloworld'

@description('Azure region for Static Web App')
param location string = 'eastus2'

// Static Web App — hosts Angular frontend + managed Functions API
resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: '${appName}-web'
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
