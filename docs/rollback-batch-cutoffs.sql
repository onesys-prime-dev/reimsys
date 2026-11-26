-- Undoes the 20261121010000_batch_cutoffs migration. Run ONLY if you are going back to the version before batch cutoffs.
-- Batches and their receipts stay; only the cutoff times, the schedules and the "added late" marks are lost (the audit log still records them).
ALTER TABLE `batch` DROP FOREIGN KEY `batch_scheduleId_fkey`;
ALTER TABLE `batch` DROP FOREIGN KEY `batch_partOfId_fkey`;
DROP INDEX `batch_scheduleId_cutoffAt_part_key` ON `batch`;
DROP INDEX `batch_cutoffAt_idx` ON `batch`;
ALTER TABLE `batch` DROP COLUMN `cutoffAt`, DROP COLUMN `cutoffClaimedAt`, DROP COLUMN `cutoffDoneAt`, DROP COLUMN `cutoffRule`, DROP COLUMN `part`, DROP COLUMN `partOfId`, DROP COLUMN `scheduleId`;
ALTER TABLE `receipt` DROP COLUMN `batchLateAt`, DROP COLUMN `batchLateNote`;
DROP TABLE `batchschedule`;
DELETE FROM `rolepermission` WHERE permissionId = (SELECT id FROM `permission` WHERE code = 'batch.schedule');
DELETE FROM `permission` WHERE code = 'batch.schedule';
DELETE FROM `_prisma_migrations` WHERE migration_name = '20261121010000_batch_cutoffs';
