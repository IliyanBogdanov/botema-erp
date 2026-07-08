# Production Data Refresh Checklist

## MinerU-only refresh

Run parsing without paid AI fallbacks:

```bash
cd backend
npm run mineru:full-refresh -- --run-id mineru-only-full-YYYYMMDD --batch-size 20 --order asc --skip-nonfinancial
```

Promote the verified MinerU run into business documents:

```bash
cd backend
npm run promote:mineru-run -- --run-id mineru-only-full-YYYYMMDD --type INVOICE_IN --min-confidence 80 --apply
```

## Business intelligence audit

The business intelligence audit must pass before trusting dashboard/VAT numbers:

```bash
cd backend
npm run audit:bi -- 2024-11-01T00:00:00.000Z
```

Expected gates after the July 2026 refresh:

- MinerU parsed coverage from 2024-11-01: at least 99%.
- Authoritative incoming invoice quality: at least 99%.
- Duplicate authoritative business document groups: 0.
- Dashboard purchases and VAT incoming purchases should agree on incoming document count.
- VAT pending credit must exclude catalogs, bank statements, offers, proformas, and huge outliers.

## Deployment checks

Before pushing:

```bash
npm run build:backend
npm run build:frontend
git diff --check
git status --short --branch
```

After deploy:

- Check backend health: `/health`.
- Log in to the production frontend.
- Verify dashboard purchases total/count.
- Verify VAT overview input VAT, pending credit, and incoming purchase count.
- Verify P&L annual cost total matches dashboard costs.

## Secret handling

Do not commit real `.env`, `.env.local`, or `.env.production` files.
Production env values belong in the deployment platform settings.

If a production env file was ever committed, rotate the affected deployment/OIDC tokens before treating the repository as clean.
