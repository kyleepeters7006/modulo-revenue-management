terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.10"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state lives in Azure Storage. Bootstrap the storage account once
  # by hand (or with a separate tiny TF module) and then `terraform init`
  # against this backend. Comment the block out for first-run local state.
  backend "azurerm" {
    # resource_group_name  = "tfstate-rg"
    # storage_account_name = "modulotfstate"
    # container_name       = "tfstate"
    # key                  = "modulo.tfstate"
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy    = false
      recover_soft_deleted_key_vaults = true
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
}

provider "random" {}
