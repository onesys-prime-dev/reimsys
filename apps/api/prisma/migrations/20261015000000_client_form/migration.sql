
-- DropForeignKey
ALTER TABLE `receipt` DROP FOREIGN KEY `receipt_categoryId_fkey`;

-- AlterTable
ALTER TABLE `receipt` ADD COLUMN `birInvoice` BOOLEAN NULL,
    ADD COLUMN `ckAddress` BOOLEAN NULL,
    ADD COLUMN `ckCompany` BOOLEAN NULL,
    ADD COLUMN `ckTin` BOOLEAN NULL,
    ADD COLUMN `invoiceNo` VARCHAR(60) NULL,
    ADD COLUMN `noBirReason` VARCHAR(500) NULL,
    ADD COLUMN `seenAddress` BOOLEAN NULL,
    ADD COLUMN `seenCompany` BOOLEAN NULL,
    ADD COLUMN `seenTin` BOOLEAN NULL,
    ADD COLUMN `transactionType` VARCHAR(10) NULL,
    ADD COLUMN `vatAmount` DECIMAL(12, 2) NULL,
    ADD COLUMN `vatType` VARCHAR(12) NULL,
    ADD COLUMN `vatableAmount` DECIMAL(12, 2) NULL,
    ADD COLUMN `vendorAddress` VARCHAR(300) NULL,
    ADD COLUMN `vendorTin` VARCHAR(30) NULL,
    ADD COLUMN `whtAmount` DECIMAL(12, 2) NULL,
    ADD COLUMN `whtRate` DECIMAL(5, 2) NULL,
    ADD COLUMN `withheld` BOOLEAN NULL,
    MODIFY `categoryId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `receipt_vendorTin_invoiceNo_idx` ON `receipt`(`vendorTin`, `invoiceNo`);

-- AddForeignKey
ALTER TABLE `receipt` ADD CONSTRAINT `receipt_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

