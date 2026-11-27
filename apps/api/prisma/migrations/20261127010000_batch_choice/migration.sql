-- AlterTable
ALTER TABLE `receipt` ADD COLUMN `wantBatchId` INTEGER NULL;

-- CreateIndex
CREATE INDEX `receipt_wantBatchId_idx` ON `receipt`(`wantBatchId`);

-- AddForeignKey
ALTER TABLE `receipt` ADD CONSTRAINT `receipt_wantBatchId_fkey` FOREIGN KEY (`wantBatchId`) REFERENCES `batch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

