-- Undoes the 20261127010000_batch_choice migration (a Med Ref choosing the batch of a draft). Run ONLY if going back to the version before it.
-- Receipts and batches stay; only the batch a draft was waiting to join is lost.
ALTER TABLE `receipt` DROP FOREIGN KEY `receipt_wantBatchId_fkey`;
DROP INDEX `receipt_wantBatchId_idx` ON `receipt`;
ALTER TABLE `receipt` DROP COLUMN `wantBatchId`;
DELETE FROM `_prisma_migrations` WHERE migration_name = '20261127010000_batch_choice';
