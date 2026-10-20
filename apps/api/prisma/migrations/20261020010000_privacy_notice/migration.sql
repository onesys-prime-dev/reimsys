-- AlterTable
ALTER TABLE `user` ADD COLUMN `privacyAcceptedAt` DATETIME(3) NULL,
    ADD COLUMN `privacyAcceptedVersion` INTEGER NULL;
