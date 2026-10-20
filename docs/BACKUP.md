# Backups

`node scripts/backup.mjs` makes one folder per run in `backups/` (git-ignored): `database.sql`, `files.tar.gz` (the uploaded receipts, proofs and reports) and `about.json`. It stops with an error and removes the half-made folder if either part fails, and keeps the newest 14 (`--keep 30` to change, `--to D:/backups` to write somewhere else, ideally another disk or a synced folder).

It needs `mysqldump` (found in `C:/xampp/mysql/bin` or the PATH; set `MYSQL_BIN` in `apps/api/.env` if it lives elsewhere) and `tar` (built into Windows 10 and later). It reads the database and storage folder from `apps/api/.env`.

## Every night (Windows)

Task Scheduler, Create Basic Task, daily at 02:00, action "Start a program":
- Program: `node`
- Arguments: `scripts/backup.mjs --to D:/reimsys-backups`
- Start in: the project folder (for example `C:\xampp\htdocs\reimsis`)

On Linux, use cron with the same command (the older mysqldump lines in `DEPLOY.md` also work).

Copy the backup folder off the machine too (cloud drive, second disk). A backup on the same disk does not survive the disk.

## Restoring

1. Stop the API.
2. `node scripts/restore.mjs backups/<folder> --yes` replaces the live database and the uploaded files with that backup. Without `--yes` it only tells you what it would do.
3. Start the API and sign in.

## Rehearse it (do this once before going live, and after big upgrades)

Restore into a spare database and folder, so the live system is untouched:

```
node scripts/restore.mjs backups/<folder> --yes --db reimsys_restore_test --files C:/temp/restored-files
```

It prints how many receipts were restored. Compare with the live count, open a few files from the restored folder, then `DROP DATABASE reimsys_restore_test` and delete the folder. This was rehearsed on this system: 672 of 672 receipts and 2,223 of 2,223 uploaded files came back.

## A copy somewhere else
Set `BACKUP_COPY_TO` in `apps/api/.env` (or pass `--copy-to <folder>`) and every run also copies the new backup to that folder (another disk, a mounted network share or a cloud-synced folder) and keeps the newest `--keep` there too. If the copy fails the run exits with an error, so the scheduler shows it. `node scripts/healthcheck.mjs` warns when the newest backup is more than 30 hours old.

## Which database login is used
Backups and restores need more rights than the running system has. When `apps/api/.env` has `MIGRATE_DATABASE_URL` (added by `node scripts/setup-db-users.mjs`), `backup.mjs` and `restore.mjs` use that full-rights login; otherwise they use `DATABASE_URL`. After switching to the limited login, run one backup and one restore rehearsal (see above) to confirm both work.
