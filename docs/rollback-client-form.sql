-- Undoes the 20261015000000_client_form migration. Run ONLY if you are going back to the version tagged "before-client-form".
-- It removes the new columns (and the answers in them). Every receipt created with the new form needs a category first,
-- so those get the first category below. Then delete the migration record so the history matches.
-- Safer alternative: restore the full backup from reimsys-backups/before-client-form-*.sql (this loses anything done since).
UPDATE `receipt` SET categoryId = (SELECT MIN(id) FROM `category`) WHERE categoryId IS NULL;
ALTER TABLE `receipt` DROP FOREIGN KEY `receipt_categoryId_fkey`;
DROP INDEX `receipt_vendorTin_invoiceNo_idx` ON `receipt`;
ALTER TABLE `receipt`
  DROP COLUMN birInvoice, DROP COLUMN ckAddress, DROP COLUMN ckCompany, DROP COLUMN ckTin, DROP COLUMN invoiceNo,
  DROP COLUMN noBirReason, DROP COLUMN seenAddress, DROP COLUMN seenCompany, DROP COLUMN seenTin, DROP COLUMN transactionType,
  DROP COLUMN vatAmount, DROP COLUMN vatType, DROP COLUMN vatableAmount, DROP COLUMN vendorAddress, DROP COLUMN vendorTin,
  DROP COLUMN whtAmount, DROP COLUMN whtRate, DROP COLUMN withheld, MODIFY `categoryId` INTEGER NOT NULL;
ALTER TABLE `receipt` ADD CONSTRAINT `receipt_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `category`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
DELETE FROM `_prisma_migrations` WHERE migration_name = '20261015000000_client_form';

-- Second step (migration 20261015010000_form_flow, the flow-chart form): run this too if you are going back past it.
ALTER TABLE `receipt` DROP COLUMN classification, DROP COLUMN invoiceUnderCompany, DROP COLUMN reasonForSpending;
DELETE FROM `_prisma_migrations` WHERE migration_name = '20261015010000_form_flow';

-- Third step (migration 20261015020000_classification_other, the "Other:" text): run this too if you are going back past it.
ALTER TABLE `receipt` DROP COLUMN classificationOther;
DELETE FROM `_prisma_migrations` WHERE migration_name = '20261015020000_classification_other';
