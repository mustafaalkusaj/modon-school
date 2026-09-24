# School App Ops Runbook

## Current Production Topology

- App path: `/var/www/modon-school`
- Runtime: `Next.js` behind `PM2`
- PM2 systemd unit: `pm2-deploy.service`
- Internal app bind: `127.0.0.1:3001`
- Nginx vhost: `/etc/nginx/sites-available/modon-school.conf`
- Public URL: `https://modon-school.com`
- Health endpoint: `/api/ping`
- Offsite backup env: `/root/.config/modon-school/offsite-backup.env`

## Restart

Restart application only:

```bash
ssh deploy@178.105.14.229 "sudo -n systemctl restart pm2-deploy"
```

Restart after validating Nginx config:

```bash
ssh deploy@178.105.14.229 "sudo -n nginx -t && sudo -n systemctl reload nginx"
```

## Status Checks

Quick app status:

```bash
ssh deploy@178.105.14.229 "systemctl is-active pm2-deploy && systemctl is-enabled pm2-deploy"
```

PM2 process status:

```bash
ssh deploy@178.105.14.229 "sudo -u deploy -H env PM2_HOME=/home/deploy/.pm2 pm2 ls"
```

Local health check:

```bash
ssh deploy@178.105.14.229 "curl -fsS http://127.0.0.1:3001/api/ping"
```

Public health check:

```bash
curl -fsS https://modon-school.com/api/ping
```

Port check:

```bash
ssh deploy@178.105.14.229 "sudo -n ss -ltnp | grep ':3001 '"
```

## Logs

PM2 application logs:

```bash
ssh deploy@178.105.14.229 "sudo -u deploy -H env PM2_HOME=/home/deploy/.pm2 pm2 logs modon-school --lines 100 --nostream"
```

PM2 service journal:

```bash
ssh deploy@178.105.14.229 "sudo -n journalctl -u pm2-deploy -n 100 --no-pager"
```

Nginx error log:

```bash
ssh deploy@178.105.14.229 "sudo -n tail -n 100 /var/log/nginx/error.log"
```

Nginx access log:

```bash
ssh deploy@178.105.14.229 "sudo -n tail -n 100 /var/log/nginx/access.log"
```

Combined operational summary:

```bash
ssh deploy@178.105.14.229 "sudo -n /usr/local/bin/modon-school-ops-summary.sh"
```

## Backups

Local backup cron:

- file: `/etc/cron.d/modon-school-backup`
- log: `/var/log/modon-school-backup.log`
- script: `/usr/local/bin/modon-school-backup.sh`

Offsite backup cron:

- file: `/etc/cron.d/modon-school-offsite-backup`
- log: `/var/log/modon-school-offsite-backup.log`
- runner: `/usr/local/bin/modon-school-offsite-backup-runner.sh`

Offsite restore check cron:

- file: `/etc/cron.d/modon-school-offsite-restore`
- log: `/var/log/modon-school-offsite-restore.log`
- runner: `/usr/local/bin/modon-school-offsite-restore-runner.sh`

Latest backup status:

```bash
ssh deploy@178.105.14.229 "sudo -n cat /var/lib/modon-school/monitoring/offsite-backup.status"
```

Latest restore-check status:

```bash
ssh deploy@178.105.14.229 "sudo -n cat /var/lib/modon-school/monitoring/offsite-restore.status"
```

Recent backup alerts:

```bash
ssh deploy@178.105.14.229 "sudo -n tail -n 50 /var/log/modon-school-alerts.log"
```

Manual offsite backup run:

```bash
ssh deploy@178.105.14.229 "sudo -n /usr/local/bin/modon-school-offsite-backup-runner.sh"
```

Manual offsite restore check:

```bash
ssh deploy@178.105.14.229 "sudo -n /usr/local/bin/modon-school-offsite-restore-runner.sh"
```

## Restore Check

The current restore check restores the latest offsite snapshot into:

- `/tmp/restic-restore-check`

Review restored files:

```bash
ssh deploy@178.105.14.229 "find /tmp/restic-restore-check -type f | sort | head -n 50"
```

Inspect recent alert events from syslog:

```bash
ssh deploy@178.105.14.229 "sudo -n journalctl -t modon-school-alert -n 50 --no-pager"
```

## Phase 2: Safe Staging Restore

Do not restore into production.

Required staging secrets:

- `STAGING_NEXT_PUBLIC_SUPABASE_URL`
- `STAGING_NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `STAGING_SUPABASE_SERVICE_ROLE_KEY`
- `STAGING_SUPABASE_DB_URL`

Recommended path:

1. Create a separate Supabase staging project.
2. Restore the latest SQL dump into staging only.
3. Validate schema, RLS, policies, and critical table counts.
4. If needed, run a separate staging app instance on port `3002`.

Restore command:

```bash
psql "$STAGING_SUPABASE_DB_URL" -f /opt/backups/modon-school/2026-04-16-031501/supabase.sql | tee /var/log/modon-school-staging-restore.log
```

Schema verification:

```bash
psql "$STAGING_SUPABASE_DB_URL" -f /Users/musatafa/modon-school/scripts/verify-production-db.sql
```

Basic table counts:

```bash
psql "$STAGING_SUPABASE_DB_URL" <<'SQL'
SELECT 'user_profiles' AS table_name, count(*) FROM public.user_profiles
UNION ALL
SELECT 'subscriptions', count(*) FROM public.subscriptions
UNION ALL
SELECT 'notifications', count(*) FROM public.notifications
UNION ALL
SELECT 'managed_user_profiles', count(*) FROM public.managed_user_profiles
ORDER BY table_name;
SQL
```

## Important Paths

- App: `/var/www/modon-school`
- PM2 config: `/var/www/modon-school/ecosystem.config.cjs`
- Production env: `/var/www/modon-school/.env.production`
- Nginx vhost: `/etc/nginx/sites-available/modon-school.conf`
- PM2 logs: `/home/deploy/.pm2/logs/`
- Nginx logs: `/var/log/nginx/`
- Local backups: `/opt/backups/modon-school`
- Offsite monitoring state: `/var/lib/modon-school/monitoring`
- Offsite secrets: `/root/.config/modon-school/offsite-backup.env`

## Emergency Commands

Tail live PM2 service logs:

```bash
ssh deploy@178.105.14.229 "sudo -n journalctl -u pm2-deploy -f"
```

Tail live Nginx error log:

```bash
ssh deploy@178.105.14.229 "sudo -n tail -f /var/log/nginx/error.log"
```

Confirm Nginx still points to the expected upstream:

```bash
ssh deploy@178.105.14.229 "sudo -n grep -n 'proxy_pass' /etc/nginx/sites-available/modon-school.conf"
```

Confirm application port and listener:

```bash
ssh deploy@178.105.14.229 "sudo -n awk -F= '/^PORT=/{print}' /var/www/modon-school/.env.production && sudo -n ss -ltnp | grep ':3001 '"
```

Run a safe full operational summary:

```bash
ssh deploy@178.105.14.229 "sudo -n /usr/local/bin/modon-school-ops-summary.sh"
```

## Safety Rules

- Do not run `psql -f` against `SUPABASE_DB_URL` for production.
- Do not edit `/root/.config/modon-school/offsite-backup.env` without preserving mode `600`.
- Do not restart Nginx without `nginx -t`.
- Do not change the application port unless `.env.production`, `ecosystem.config.cjs`, and Nginx are updated together.
