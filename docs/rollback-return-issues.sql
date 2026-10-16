-- Undoes the 20261016010000_return_issues migration. Run ONLY if you are going back to the version before "return reasons".
-- It removes the column (the ticked problems on receipts that are still "Returned" are lost; their notes stay).
-- Safer alternative: restore the full backup from reimsys-backups/before-return-issues-*.sql (this loses anything done since).
ALTER TABLE `receipt` DROP COLUMN returnIssues;
DELETE FROM `_prisma_migrations` WHERE migration_name = '20261016010000_return_issues';
