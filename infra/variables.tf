variable "name_prefix" {
  description = "Short prefix used in resource names. Keep <= 10 chars, alphanumeric. Combined with `environment` and a random suffix for global-unique resources (storage, key vault, app)."
  type        = string
  default     = "modulo"

  validation {
    condition     = can(regex("^[a-z0-9]{2,10}$", var.name_prefix))
    error_message = "name_prefix must be 2-10 lowercase alphanumeric characters."
  }
}

variable "environment" {
  description = "Deployment environment. Used in resource names and tags."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "environment must be one of: dev, staging, prod."
  }
}

variable "location" {
  description = "Azure region. Use a region that supports all required services (App Service, Postgres Flexible Server, Redis, Private DNS)."
  type        = string
  default     = "eastus2"
}

variable "tags" {
  description = "Tags applied to every resource. Environment and ManagedBy are added automatically."
  type        = map(string)
  default = {
    Project = "modulo-revenue-management"
  }
}

# -----------------------------------------------------------------------------
# Networking
# -----------------------------------------------------------------------------

variable "vnet_address_space" {
  description = "CIDR for the VNet."
  type        = list(string)
  default     = ["10.40.0.0/20"]
}

variable "subnet_app_cidr" {
  description = "Subnet for App Service VNet integration. Must be delegated to Microsoft.Web/serverFarms and have no other resources."
  type        = string
  default     = "10.40.1.0/24"
}

variable "subnet_postgres_cidr" {
  description = "Subnet delegated to Microsoft.DBforPostgreSQL/flexibleServers."
  type        = string
  default     = "10.40.2.0/24"
}

variable "subnet_privatelink_cidr" {
  description = "Subnet for private endpoints (Redis, Key Vault if desired)."
  type        = string
  default     = "10.40.3.0/24"
}

# -----------------------------------------------------------------------------
# App Service
# -----------------------------------------------------------------------------

variable "app_service_sku" {
  description = "App Service Plan SKU. P1v3 / P2v3 / P3v3 for production; B1 for dev."
  type        = string
  default     = "P1v3"
}

variable "app_node_version" {
  description = "Node.js version on the Linux App Service."
  type        = string
  default     = "20-lts"
}

variable "app_health_check_path" {
  description = "Path App Service hits to determine instance health. Implement this lightweight endpoint in Express."
  type        = string
  default     = "/api/health"
}

variable "app_always_on" {
  description = "Required for in-process cron and setTimeout background jobs."
  type        = bool
  default     = true
}

variable "app_instance_count" {
  description = "Number of App Service instances. >1 requires the Redis-backed session store and a Redis-lock around the daily cron."
  type        = number
  default     = 1
}

# -----------------------------------------------------------------------------
# PostgreSQL Flexible Server
# -----------------------------------------------------------------------------

variable "postgres_sku" {
  description = "Postgres Flexible Server SKU. Burstable for dev, GeneralPurpose for prod."
  type        = string
  default     = "B_Standard_B2ms"
}

variable "postgres_version" {
  description = "Major Postgres version."
  type        = string
  default     = "16"
}

variable "postgres_storage_mb" {
  description = "Storage allocated to Postgres in MB. Minimum 32768."
  type        = number
  default     = 65536
}

variable "postgres_admin_username" {
  description = "Admin user created on the Postgres server. The connection string built for the app uses this."
  type        = string
  default     = "modulo_admin"
}

variable "postgres_database_name" {
  description = "Logical database created on the server and used by the app."
  type        = string
  default     = "modulo"
}

variable "postgres_backup_retention_days" {
  description = "1-35 days. Geo-redundant backups are billed extra."
  type        = number
  default     = 14
}

variable "postgres_geo_redundant_backup" {
  description = "Enable geo-redundant backups. Adds cost; only available in paired regions."
  type        = bool
  default     = false
}

# -----------------------------------------------------------------------------
# Redis
# -----------------------------------------------------------------------------

variable "redis_sku" {
  description = "Redis SKU: Basic, Standard, or Premium."
  type        = string
  default     = "Basic"

  validation {
    condition     = contains(["Basic", "Standard", "Premium"], var.redis_sku)
    error_message = "redis_sku must be Basic, Standard, or Premium."
  }
}

variable "redis_family" {
  description = "Redis family: C (Basic/Standard) or P (Premium)."
  type        = string
  default     = "C"
}

variable "redis_capacity" {
  description = "Redis capacity. For Basic/Standard C: 0-6. For Premium P: 1-5."
  type        = number
  default     = 0
}

# -----------------------------------------------------------------------------
# Secrets (populate with `-var` or via Key Vault references after apply)
# -----------------------------------------------------------------------------
#
# These are written into Key Vault. Leaving them empty creates the secret with
# a placeholder value you can rotate from the portal / CLI later — safer than
# committing real secrets to a tfvars file.

variable "anthropic_api_key" {
  description = "Anthropic API key. Leave blank to create a placeholder you fill in later."
  type        = string
  default     = ""
  sensitive   = true
}

variable "openai_api_key" {
  description = "OpenAI / Replit AI proxy API key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "openai_base_url" {
  description = "Base URL for the OpenAI-compatible endpoint (AI_INTEGRATIONS_OPENAI_BASE_URL)."
  type        = string
  default     = ""
}

variable "alpha_vantage_api_key" {
  description = "Alpha Vantage API key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "session_secret" {
  description = "Express session secret. If left blank, a random one is generated and stored in Key Vault."
  type        = string
  default     = ""
  sensitive   = true
}

# -----------------------------------------------------------------------------
# Access control
# -----------------------------------------------------------------------------

variable "kv_admin_object_ids" {
  description = "Azure AD object IDs (users, groups, service principals) that get Key Vault Administrator at deploy time. Usually your own object ID + the CI service principal."
  type        = list(string)
  default     = []
}
