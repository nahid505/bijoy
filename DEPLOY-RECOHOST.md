# RecoHost deployment — moved

This guide was written when the app ran on PostgreSQL only. The app now runs on **MySQL 8.0.16+ / MariaDB 10.6+**
as well, which is what RecoHost cPanel offers. Use:

- **[FINAL-RECOHOST-DEPLOYMENT.md](FINAL-RECOHOST-DEPLOYMENT.md)** — step-by-step deployment (cPanel + MySQL)
- **[docs/MYSQL-MIGRATION-PLAN.md](docs/MYSQL-MIGRATION-PLAN.md)** — what changed for MySQL, test results, known differences

A PostgreSQL build for cPanel is still possible (`npm run package:cpanel -- --db=postgresql`), and the Docker
setup for a VPS is unchanged (`docker compose --profile https up -d --build`).
