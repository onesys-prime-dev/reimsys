-- Undoes the 20261020010000_privacy_notice migration. Run ONLY if you are going back to the version before the privacy notice.
-- It removes the columns (who accepted which version, and when). The history log keeps the "privacy.accepted" entries.
-- Safer alternative: restore the full backup taken before the update (this loses anything done since).
ALTER TABLE `user` DROP COLUMN privacyAcceptedAt, DROP COLUMN privacyAcceptedVersion;
DELETE FROM `_prisma_migrations` WHERE migration_name = '20261020010000_privacy_notice';
