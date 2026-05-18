# infra/

Terraform definition for deploying the Modulo Revenue Management app to Azure.

Provisions:

- Resource group, VNet (app / postgres / private-link subnets)
- App Service Plan (Linux) + Linux Web App (Node 20, system-assigned MSI, VNet-integrated)
- PostgreSQL Flexible Server (VNet-injected, private DNS, public access disabled)
- Azure Cache for Redis (Basic by default; Premium switches to private endpoint)
- Key Vault (RBAC, soft-delete) with secrets referenced by the Web App at runtime
- Log Analytics workspace + Application Insights, with diagnostic settings on the Web App and Postgres

## First-run checklist

1. Install Terraform >= 1.6 and the Azure CLI; `az login` to the subscription you want to deploy into.
2. (Recommended) Bootstrap an Azure Storage account for remote state, then uncomment the `backend "azurerm"` block in `providers.tf` and fill in the values.
3. `cp terraform.tfvars.example terraform.tfvars` and edit. At minimum, set your `kv_admin_object_ids` so you can read/write secrets in Key Vault after the deploy.
4. `terraform init`
5. `terraform plan -out tfplan`
6. `terraform apply tfplan`

Plan and apply take ~15 minutes the first time (Postgres Flexible Server is the long pole).

## After the apply

The Key Vault is created with placeholder values (`REPLACE_ME`) for each third-party secret. Seed the real values once:

```bash
KV=$(terraform output -raw key_vault_name)
az keyvault secret set --vault-name "$KV" --name anthropic-api-key     --value "<value>"
az keyvault secret set --vault-name "$KV" --name openai-api-key        --value "<value>"
az keyvault secret set --vault-name "$KV" --name openai-base-url       --value "<value>"
az keyvault secret set --vault-name "$KV" --name alpha-vantage-api-key --value "<value>"
```

`DATABASE_URL`, `REDIS_URL`, and `SESSION_SECRET` are populated automatically.

## Deploy the app

Build locally and push the zip:

```bash
npm ci
npm run build
# package what App Service needs to run `node dist/index.js`
zip -r app.zip dist package.json package-lock.json
az webapp deploy \
  --resource-group "$(terraform output -raw resource_group_name)" \
  --name "$(terraform output -raw web_app_name)" \
  --src-path app.zip \
  --type zip
```

Or wire the same thing through GitHub Actions with `azure/webapps-deploy@v3` and a federated credential against the Web App.

## Things to know

- **Schema push.** `npm run db:push` needs to reach Postgres. Either run it from a VM/runner inside the VNet, or temporarily allow your IP via `azurerm_postgresql_flexible_server_firewall_rule` for the migration window.
- **Scaling past one instance.** `app_instance_count` defaults to 1 because the cron in `server/index.ts` and the session middleware both assume a single process. Bump it only after switching `express-session` to a Redis store and adding a Redis lock around the daily pricing recalc.
- **Redis SKU.** Basic doesn't support private endpoints — traffic uses the TLS public endpoint (still on Azure backbone). Switch to `redis_sku = "Premium"` if you need a private endpoint, and add an `azurerm_private_endpoint` resource.
- **Always On.** Required for the in-process scheduler; the Free/Shared SKUs don't support it. Don't drop below B1.
- **Secret rotation.** The `azurerm_key_vault_secret` resources for third-party keys have `ignore_changes = [value]`, so rotating in the portal/CLI won't be reverted on the next apply.
