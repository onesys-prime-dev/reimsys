-- CreateTable
CREATE TABLE `form_draft` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `receiptId` INTEGER NULL,
    `step` INTEGER NOT NULL DEFAULT 0,
    `data` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `form_draft_userId_updatedAt_idx`(`userId`, `updatedAt`),
    UNIQUE INDEX `form_draft_userId_receiptId_key`(`userId`, `receiptId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `form_draft` ADD CONSTRAINT `form_draft_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `form_draft` ADD CONSTRAINT `form_draft_receiptId_fkey` FOREIGN KEY (`receiptId`) REFERENCES `receipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
