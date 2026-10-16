-- AlterTable
ALTER TABLE `receipt` ADD COLUMN `paidAmount` DECIMAL(12, 2) NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL,
    ADD COLUMN `paidShortReason` VARCHAR(300) NULL,
    ADD COLUMN `paymentId` INTEGER NULL;

-- CreateTable
CREATE TABLE `payment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `paymentNo` VARCHAR(30) NOT NULL,
    `payeeId` INTEGER NOT NULL,
    `method` VARCHAR(40) NOT NULL,
    `paidOn` DATE NOT NULL,
    `proofFile` VARCHAR(200) NOT NULL,
    `proofMime` VARCHAR(60) NOT NULL,
    `proofSize` INTEGER NOT NULL,
    `proofSha256` VARCHAR(64) NOT NULL,
    `recordedById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_paymentNo_key`(`paymentNo`),
    INDEX `payment_payeeId_idx`(`payeeId`),
    INDEX `payment_recordedById_idx`(`recordedById`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `receipt_paymentId_idx` ON `receipt`(`paymentId`);

-- AddForeignKey
ALTER TABLE `receipt` ADD CONSTRAINT `receipt_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `payment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment` ADD CONSTRAINT `payment_payeeId_fkey` FOREIGN KEY (`payeeId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment` ADD CONSTRAINT `payment_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

