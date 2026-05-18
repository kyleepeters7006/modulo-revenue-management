output "resource_group_name" {
  description = "Name of the resource group everything lives in."
  value       = azurerm_resource_group.this.name
}

output "web_app_name" {
  description = "App Service name — use this with `az webapp` and the GitHub deploy action."
  value       = azurerm_linux_web_app.this.name
}

output "web_app_default_hostname" {
  description = "Default HTTPS hostname for the deployed app."
  value       = azurerm_linux_web_app.this.default_hostname
}

output "web_app_principal_id" {
  description = "Object ID of the Web App's system-assigned managed identity. Grant additional roles to this principal as needed."
  value       = azurerm_linux_web_app.this.identity[0].principal_id
}

output "postgres_fqdn" {
  description = "Postgres Flexible Server FQDN. Only resolvable from inside the VNet."
  value       = azurerm_postgresql_flexible_server.this.fqdn
}

output "postgres_database_name" {
  description = "Logical database the app connects to."
  value       = azurerm_postgresql_flexible_server_database.this.name
}

output "redis_hostname" {
  description = "Redis cache hostname (TLS port 6380)."
  value       = azurerm_redis_cache.this.hostname
}

output "key_vault_name" {
  description = "Key Vault name. Use for `az keyvault secret set` to rotate secrets."
  value       = azurerm_key_vault.this.name
}

output "key_vault_uri" {
  description = "Key Vault DNS URI."
  value       = azurerm_key_vault.this.vault_uri
}

output "application_insights_connection_string" {
  description = "App Insights connection string. Already wired into the Web App; exposed for diagnostics."
  value       = azurerm_application_insights.this.connection_string
  sensitive   = true
}

output "log_analytics_workspace_id" {
  description = "Workspace ID for diagnostics and queries."
  value       = azurerm_log_analytics_workspace.this.id
}
