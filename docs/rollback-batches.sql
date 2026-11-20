-- Undoes the 20261120010000_batches migration. Run ONLY if you are going back to the version before batches.
-- The receipts themselves are untouched; only which batch each was in is lost (the audit log still records it).
ALTER TABLE `receipt` DROP FOREIGN KEY `receipt_batchId_fkey`;
DROP INDEX `receipt_batchId_idx` ON `receipt`;
ALTER TABLE `receipt` DROP COLUMN `batchId`;
ALTER TABLE `notification` DROP COLUMN `batchId`;
DROP TABLE `batch`;
DELETE FROM `rolepermission` WHERE permissionId = (SELECT id FROM `permission` WHERE code = 'batch.manage');
DELETE FROM `permission` WHERE code = 'batch.manage';
DELETE FROM `_prisma_migrations` WHERE migration_name = '20261120010000_batches';
