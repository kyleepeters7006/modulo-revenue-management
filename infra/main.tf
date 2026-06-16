terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

# -----------------------------------------------------------------------------
# Shared values
# -----------------------------------------------------------------------------

data "azurerm_client_config" "current" {}

resource "random_string" "suffix" {
  length  = 4
  upper   = false
  special = false
  numeric = true
}

# this instruction creates a password
resource "random_password" "postgres" {
  length      = 32
  special     = true
  min_lower   = 2
  min_upper   = 2
  min_numeric = 2
  min_special = 2
  # Postgres rejects a handful of characters in passwords passed on the URL.
  override_special = "!@#%^*-_+="
}

resource "random_password" "session_secret" {
  count   = var.session_secret == "" ? 1 : 0
  length  = 64
  special = false
}

locals {
  base_name = "${var.name_prefix}-${var.environment}"
  suffix    = random_string.suffix.result

  # Some Azure resources have very tight naming (alphanumeric, length-limited,
  # globally unique). We compute a no-dash variant for those.
  base_name_compact = "${var.name_prefix}${var.environment}"

  tags = merge(
    var.tags,
    {
      Environment = var.environment
      ManagedBy   = "terraform"
    },
  )

  session_secret_effective = var.session_secret != "" ? var.session_secret : random_password.session_secret[0].result

  # URL-encode credentials: the generated password may contain @ : / # etc.,
  # any of which would corrupt the URI without encoding.
  postgres_connection_string = format(
    "postgresql://%s:%s@%s:5432/%s?sslmode=require",
    urlencode(var.postgres_admin_username),
    urlencode(random_password.postgres.result),
    azurerm_postgresql_flexible_server.this.fqdn,
    azurerm_postgresql_flexible_server_database.this.name,
  )

  redis_connection_string = format(
    "rediss://:%s@%s:6380",
    urlencode(azurerm_redis_cache.this.primary_access_key),
    azurerm_redis_cache.this.hostname,
  )
}

# -----------------------------------------------------------------------------
# Resource group
# -----------------------------------------------------------------------------

resource "azurerm_resource_group" "this" {
  name     = "${local.base_name}-rg"
  location = var.location
  tags     = local.tags
}

# -----------------------------------------------------------------------------
# Observability: Log Analytics + Application Insights
# -----------------------------------------------------------------------------

resource "azurerm_log_analytics_workspace" "this" {
  name                = "${local.base_name}-law"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

# I would like to have the app Insights at least (don't need the log analytics so necessary) (KG)
resource "azurerm_application_insights" "this" {
  name                = "${local.base_name}-appi"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  workspace_id        = azurerm_log_analytics_workspace.this.id
  application_type    = "Node.JS"
  tags                = local.tags
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------

resource "azurerm_virtual_network" "this" {
  name                = "${local.base_name}-vnet"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  address_space       = var.vnet_address_space
  tags                = local.tags
}

resource "azurerm_subnet" "app" {
  name                 = "snet-app"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [var.subnet_app_cidr]

  delegation {
    name = "appservice-delegation"
    service_delegation {
      name = "Microsoft.Web/serverFarms"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/action",
      ]
    }
  }

  # App Service VNet integration needs outbound to Postgres / Redis / etc.
  service_endpoints = ["Microsoft.KeyVault"]
}

resource "azurerm_subnet" "postgres" {
  name                 = "snet-postgres"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [var.subnet_postgres_cidr]

  delegation {
    name = "postgres-delegation"
    service_delegation {
      name = "Microsoft.DBforPostgreSQL/flexibleServers"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/join/action",
      ]
    }
  }
}

resource "azurerm_subnet" "privatelink" {
  name                                          = "snet-privatelink"
  resource_group_name                           = azurerm_resource_group.this.name
  virtual_network_name                          = azurerm_virtual_network.this.name
  address_prefixes                              = [var.subnet_privatelink_cidr]
  private_link_service_network_policies_enabled = false
}

# -----------------------------------------------------------------------------
# PostgreSQL Flexible Server (private, VNet-injected)
# -----------------------------------------------------------------------------

resource "azurerm_private_dns_zone" "postgres" {
  name                = "${local.base_name_compact}.private.postgres.database.azure.com"
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

resource "azurerm_private_dns_zone_virtual_network_link" "postgres" {
  name                  = "pdz-postgres-link"
  resource_group_name   = azurerm_resource_group.this.name
  private_dns_zone_name = azurerm_private_dns_zone.postgres.name
  virtual_network_id    = azurerm_virtual_network.this.id
  registration_enabled  = false
  tags                  = local.tags
}

# I need this for application to work (KG)
resource "azurerm_postgresql_flexible_server" "this" {
  name                = "${local.base_name}-pg-${local.suffix}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name

  version                = var.postgres_version
  sku_name               = var.postgres_sku
  storage_mb             = var.postgres_storage_mb
  administrator_login    = var.postgres_admin_username
  administrator_password = random_password.postgres.result

  delegated_subnet_id           = azurerm_subnet.postgres.id
  private_dns_zone_id           = azurerm_private_dns_zone.postgres.id
  public_network_access_enabled = false

  backup_retention_days        = var.postgres_backup_retention_days
  geo_redundant_backup_enabled = var.postgres_geo_redundant_backup

  # Zone is left unset so Azure picks an available one (some regions have no AZs).
  # HA failovers can flip it, so we ignore it on subsequent plans.

  tags = local.tags

  lifecycle {
    ignore_changes = [
      zone,
    ]
  }

  depends_on = [
    azurerm_private_dns_zone_virtual_network_link.postgres,
  ]
}

# I need this for application to work (KG)
resource "azurerm_postgresql_flexible_server_database" "this" {
  name      = var.postgres_database_name
  server_id = azurerm_postgresql_flexible_server.this.id
  collation = "en_US.utf8"
  charset   = "UTF8"
}

# -----------------------------------------------------------------------------
# Redis (Basic/Standard use the public TLS endpoint; Premium can use a PE) - probably unnecessary
# -----------------------------------------------------------------------------

resource "azurerm_redis_cache" "this" {
  name                 = "${local.base_name}-redis-${local.suffix}"
  location             = azurerm_resource_group.this.location
  resource_group_name  = azurerm_resource_group.this.name
  sku_name             = var.redis_sku
  family               = var.redis_family
  capacity             = var.redis_capacity
  minimum_tls_version  = "1.2"
  non_ssl_port_enabled = false

  # Only Premium supports private endpoints + VNet injection. For Basic/Standard
  # we connect via the public TLS endpoint; traffic stays on the Azure backbone.
  public_network_access_enabled = var.redis_sku != "Premium"

  redis_configuration {
    # Default Redis settings are appropriate for an Express session store.
  }

  tags = local.tags
}

# -----------------------------------------------------------------------------
# Key Vault - 
# -----------------------------------------------------------------------------

# I would like to have dedicated key vault for third party secrets (KG)
resource "azurerm_key_vault" "this" {
  name                = "${var.name_prefix}${var.environment}kv${local.suffix}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  tenant_id           = data.azurerm_client_config.current.tenant_id

  sku_name                      = "standard"
  enable_rbac_authorization     = true
  purge_protection_enabled      = true
  soft_delete_retention_days    = 30
  public_network_access_enabled = true

  network_acls {
    default_action = "Allow"
    bypass         = "AzureServices"
  }

  tags = local.tags
}

# Grant the apply principal admin so it can write the secrets below.
resource "azurerm_role_assignment" "kv_admin_deployer" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = data.azurerm_client_config.current.object_id
}

# Additional human / CI principals that need to manage secrets.
resource "azurerm_role_assignment" "kv_admin_extra" {
  for_each             = toset(var.kv_admin_object_ids)
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Administrator"
  principal_id         = each.value
}

# Grant the Web App's managed identity read access to secrets at runtime.
resource "azurerm_role_assignment" "kv_app_reader" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app.this.identity[0].principal_id
}

# -----------------------------------------------------------------------------
# Key Vault secrets
# -----------------------------------------------------------------------------

# I need this for application to work (KG)
resource "azurerm_key_vault_secret" "database_url" {
  name         = "database-url"
  value        = local.postgres_connection_string
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_role_assignment.kv_admin_deployer]
}

# I need this for application to work (KG)
resource "azurerm_key_vault_secret" "postgres_password" {
  name         = "postgres-admin-password"
  value        = random_password.postgres.result
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_role_assignment.kv_admin_deployer]
}

resource "azurerm_key_vault_secret" "redis_url" {
  name         = "redis-url"
  value        = local.redis_connection_string
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_role_assignment.kv_admin_deployer]
}

resource "azurerm_key_vault_secret" "session_secret" {
  name         = "session-secret"
  value        = local.session_secret_effective
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_role_assignment.kv_admin_deployer]
}

# I need this for application to work (KG)
resource "azurerm_key_vault_secret" "anthropic_api_key" {
  name         = "anthropic-api-key"
  value        = var.anthropic_api_key != "" ? var.anthropic_api_key : "REPLACE_ME"
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_role_assignment.kv_admin_deployer]

  lifecycle {
    # Allow rotating the value out of band (portal / CLI) without TF reverting it.
    ignore_changes = [value]
  }
}

# I need this for application to work (KG)
resource "azurerm_key_vault_secret" "openai_api_key" {
  name         = "openai-api-key"
  value        = var.openai_api_key != "" ? var.openai_api_key : "REPLACE_ME"
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_role_assignment.kv_admin_deployer]

  lifecycle {
    ignore_changes = [value]
  }
}

# I need this for application to work (KG)
resource "azurerm_key_vault_secret" "openai_base_url" {
  name         = "openai-base-url"
  value        = var.openai_base_url != "" ? var.openai_base_url : "REPLACE_ME"
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_role_assignment.kv_admin_deployer]

  lifecycle {
    ignore_changes = [value]
  }
}

# I need this for application to work (KG)
resource "azurerm_key_vault_secret" "alpha_vantage_api_key" {
  name         = "alpha-vantage-api-key"
  value        = var.alpha_vantage_api_key != "" ? var.alpha_vantage_api_key : "REPLACE_ME"
  key_vault_id = azurerm_key_vault.this.id

  depends_on = [azurerm_role_assignment.kv_admin_deployer]

  lifecycle {
    ignore_changes = [value]
  }
}

# -----------------------------------------------------------------------------
# App Service   # I need this for application to work (KG)
# -----------------------------------------------------------------------------

resource "azurerm_service_plan" "this" {
  name                = "${local.base_name}-asp"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  os_type             = "Linux"
  sku_name            = var.app_service_sku
  worker_count        = var.app_instance_count
  tags                = local.tags
}

resource "azurerm_linux_web_app" "this" {
  name                = "${local.base_name}-app-${local.suffix}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  service_plan_id     = azurerm_service_plan.this.id

  https_only                                     = true
  client_affinity_enabled                        = false
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false
  public_network_access_enabled                  = true

  virtual_network_subnet_id = azurerm_subnet.app.id

  identity {
    type = "SystemAssigned"
  }

  site_config {
    always_on                               = var.app_always_on
    http2_enabled                           = true
    minimum_tls_version                     = "1.2"
    ftps_state                              = "Disabled"
    health_check_path                       = var.app_health_check_path
    health_check_eviction_time_in_min       = 5
    vnet_route_all_enabled                  = true
    container_registry_use_managed_identity = false

    application_stack {
      node_version = var.app_node_version
    }

    app_command_line = "node dist/index.js"
  }

  app_settings = {
    # Runtime config the server reads at boot. The Linux Node stack injects
    # PORT automatically; the Express server must listen on process.env.PORT.
    NODE_ENV                           = "production"
    WEBSITE_RUN_FROM_PACKAGE           = "1"
    SCM_DO_BUILD_DURING_DEPLOYMENT     = "false"
    WEBSITE_NODE_DEFAULT_VERSION       = "~20"
    WEBSITE_HTTPLOGGING_RETENTION_DAYS = "7"

    # Wire telemetry. The Node SDK auto-instruments when these are set.
    APPLICATIONINSIGHTS_CONNECTION_STRING       = azurerm_application_insights.this.connection_string
    APPINSIGHTS_INSTRUMENTATIONKEY              = azurerm_application_insights.this.instrumentation_key
    ApplicationInsightsAgent_EXTENSION_VERSION  = "~3"
    XDT_MicrosoftApplicationInsights_NodeJS     = "1"

    # Secrets via Key Vault references. The Web App's MSI needs the
    # 'Key Vault Secrets User' role on the vault (granted above).
    DATABASE_URL                     = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.database_url.versionless_id})"
    REDIS_URL                        = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.redis_url.versionless_id})"
    SESSION_SECRET                   = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.session_secret.versionless_id})"
    ANTHROPIC_API_KEY                = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.anthropic_api_key.versionless_id})"
    AI_INTEGRATIONS_OPENAI_API_KEY   = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.openai_api_key.versionless_id})"
    AI_INTEGRATIONS_OPENAI_BASE_URL  = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.openai_base_url.versionless_id})"
    ALPHA_VANTAGE_API_KEY            = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.alpha_vantage_api_key.versionless_id})"
  }

  logs {
    http_logs {
      file_system {
        retention_in_days = 7
        retention_in_mb   = 35
      }
    }
    application_logs {
      file_system_level = "Information"
    }
  }

  tags = local.tags

  lifecycle {
    # Deploys flip this app setting; ignore so TF doesn't fight CI.
    ignore_changes = [
      app_settings["WEBSITE_RUN_FROM_PACKAGE"],
    ]
  }
}

# -----------------------------------------------------------------------------
# Diagnostic settings → Log Analytics. Those probably also will be needed (KG)
# -----------------------------------------------------------------------------

resource "azurerm_monitor_diagnostic_setting" "app" {
  name                       = "diag-app"
  target_resource_id         = azurerm_linux_web_app.this.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id

  enabled_log {
    category_group = "allLogs"
  }

  metric {
    category = "AllMetrics"
  }
}

resource "azurerm_monitor_diagnostic_setting" "postgres" {
  name                       = "diag-postgres"
  target_resource_id         = azurerm_postgresql_flexible_server.this.id
  log_analytics_workspace_id = azurerm_log_analytics_workspace.this.id

  enabled_log {
    category = "PostgreSQLLogs"
  }

  metric {
    category = "AllMetrics"
  }
}
