-- Undoes the 20261015030000_payment_step migration. Run ONLY if you are going back to the version tagged "before-payment-step".
-- Safer alternative: restore the full backup from reimsys-backups/before-payment-step-*.sql (this loses anything done since).
-- 1. Paid receipts go back to Approved, so nothing is left in a status the old version does not know.
UPDATE `receipt` SET status = 'approved', paymentId = NULL, paidAmount = NULL, paidShortReason = NULL, paidAt = NULL WHERE status = 'paid';
-- 2. Accounting users are switched off and moved to Med Ref, then the Accounting role and its permission are removed.
UPDATE `user` SET isActive = 0, roleId = (SELECT id FROM `role` WHERE code = 'medref') WHERE roleId = (SELECT id FROM `role` WHERE code = 'accounting');
DELETE FROM `rolepermission` WHERE roleId = (SELECT id FROM `role` WHERE code = 'accounting');
DELETE FROM `role` WHERE code = 'accounting';
DELETE FROM `rolepermission` WHERE permissionId = (SELECT id FROM `permission` WHERE code = 'payment.mark');
DELETE FROM `permission` WHERE code = 'payment.mark';
-- 3. The new columns and the payment table.
ALTER TABLE `receipt` DROP FOREIGN KEY `receipt_paymentId_fkey`;
DROP INDEX `receipt_paymentId_idx` ON `receipt`;
ALTER TABLE `receipt` DROP COLUMN paymentId, DROP COLUMN paidAmount, DROP COLUMN paidShortReason, DROP COLUMN paidAt;
DROP TABLE `payment`;
DELETE FROM `setting` WHERE `key` = 'payment.methods';
DELETE FROM `_prisma_migrations` WHERE migration_name = '20261015030000_payment_step';
-- Uploaded proof files stay on disk under storage/proofs. They are not referenced any more and can be archived or deleted by hand.
