-- AlterTable
ALTER TABLE `notification` ADD COLUMN `batchId` INTEGER NULL;

-- AlterTable
ALTER TABLE `receipt` ADD COLUMN `batchId` INTEGER NULL;

-- CreateTable
CREATE TABLE `batch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(30) NOT NULL,
    `name` VARCHAR(80) NULL,
    `createdById` INTEGER NOT NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `batch_code_key`(`code`),
    INDEX `batch_closedAt_idx`(`closedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `receipt_batchId_idx` ON `receipt`(`batchId`);

-- AddForeignKey
ALTER TABLE `receipt` ADD CONSTRAINT `receipt_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `batch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `batch` ADD CONSTRAINT `batch_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

