
-- AlterTable
ALTER TABLE `receipt` ADD COLUMN `classification` VARCHAR(30) NULL,
    ADD COLUMN `invoiceUnderCompany` BOOLEAN NULL,
    ADD COLUMN `reasonForSpending` VARCHAR(300) NULL;

