# EdgeCenter Relay - Multi-Domain Setup

This directory manages multiple domain relays using the same Terraform code but different configurations.

## Domains

- **prostocupli.com** - Main proxy domain
- **u-survey.ru** - Secondary proxy domain

## Usage

### For prostocupli.com:

```bash
# Initialize with prostocupli backend
terraform init -backend-config=configs/prostocupli.tfbackend -reconfigure

# Plan
terraform plan -var-file=configs/prostocupli.tfvars -var-file=secrets.auto.tfvars

# Apply
terraform apply -var-file=configs/prostocupli.tfvars -var-file=secrets.auto.tfvars

# Destroy
terraform destroy -var-file=configs/prostocupli.tfvars -var-file=secrets.auto.tfvars
```

### For u-survey.ru:

```bash
# Initialize with u-survey backend
terraform init -backend-config=configs/u-survey.tfbackend -reconfigure

# Plan
terraform plan -var-file=configs/u-survey.tfvars -var-file=secrets.auto.tfvars

# Apply
terraform apply -var-file=configs/u-survey.tfvars -var-file=secrets.auto.tfvars

# Destroy
terraform destroy -var-file=configs/u-survey.tfvars -var-file=secrets.auto.tfvars
```

## Important Notes

1. **Always use `-reconfigure` when switching domains** - This ensures Terraform uses the correct backend state
2. **Backend and vars must match** - Always use matching `.tfbackend` and `.tfvars` files
3. **Secrets are shared** - The `secrets.auto.tfvars` file is shared between both domains
4. **State is separate** - Each domain has its own state file in R2:
   - prostocupli.com → `relay-prosto/terraform.tfstate`
   - u-survey.ru → `relay-usurvey/terraform.tfstate`

## Adding a New Domain

1. Create `configs/newdomain.tfbackend`:
   ```hcl
   key = "relay-newdomain/terraform.tfstate"
   ```

2. Create `configs/newdomain.tfvars` with domain-specific configuration

3. Run terraform commands as shown above

