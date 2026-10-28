-- The three tables added in the last updates used underscores (charge_location, email_schedule, form_draft) while every older table is one lower-case
-- word (emaillog, receiptevidence, ...). They are renamed to match, so the names are consistent on a case-sensitive server too.
-- Indexes and foreign keys are renamed with them (dropped and added again, which works on every MySQL and MariaDB version) so the structure still
-- matches the schema exactly. Nothing is lost: the rows stay in place.

RENAME TABLE `charge_location` TO `chargelocation`, `email_schedule` TO `emailschedule`, `form_draft` TO `formdraft`;

-- chargelocation: the unique name index. (The foreign key from receipt follows the rename by itself.)
ALTER TABLE `chargelocation` DROP INDEX `charge_location_name_key`;
CREATE UNIQUE INDEX `chargelocation_name_key` ON `chargelocation`(`name`);

-- formdraft: foreign keys, then indexes, then the foreign keys again under their new names.
ALTER TABLE `formdraft` DROP FOREIGN KEY `form_draft_userId_fkey`;
ALTER TABLE `formdraft` DROP FOREIGN KEY `form_draft_receiptId_fkey`;
ALTER TABLE `formdraft` DROP INDEX `form_draft_receiptId_fkey`;
ALTER TABLE `formdraft` DROP INDEX `form_draft_userId_receiptId_key`;
ALTER TABLE `formdraft` DROP INDEX `form_draft_userId_updatedAt_idx`;
CREATE UNIQUE INDEX `formdraft_userId_receiptId_key` ON `formdraft`(`userId`, `receiptId`);
CREATE INDEX `formdraft_userId_updatedAt_idx` ON `formdraft`(`userId`, `updatedAt`);
ALTER TABLE `formdraft` ADD CONSTRAINT `formdraft_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `formdraft` ADD CONSTRAINT `formdraft_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `receipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
