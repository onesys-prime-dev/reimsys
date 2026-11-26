-- AlterTable
ALTER TABLE `batch` ADD COLUMN `cutoffAt` DATETIME(3) NULL,
    ADD COLUMN `cutoffClaimedAt` DATETIME(3) NULL,
    ADD COLUMN `cutoffDoneAt` DATETIME(3) NULL,
    ADD COLUMN `cutoffRule` TEXT NULL,
    ADD COLUMN `part` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `partOfId` INTEGER NULL,
    ADD COLUMN `scheduleId` INTEGER NULL;

-- AlterTable
ALTER TABLE `receipt` ADD COLUMN `batchLateAt` DATETIME(3) NULL,
    ADD COLUMN `batchLateNote` VARCHAR(300) NULL;

-- CreateTable
CREATE TABLE `batchschedule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(60) NOT NULL,
    `isOn` BOOLEAN NOT NULL DEFAULT true,
    `repeat` VARCHAR(10) NOT NULL,
    `days` VARCHAR(100) NOT NULL,
    `time` VARCHAR(5) NOT NULL,
    `timeZone` VARCHAR(60) NOT NULL,
    `rule` TEXT NOT NULL,
    `lastSlotAt` DATETIME(3) NULL,
    `lastRunAt` DATETIME(3) NULL,
    `lastBatchId` INTEGER NULL,
    `lastCount` INTEGER NOT NULL DEFAULT 0,
    `createdById` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `batch_cutoffAt_idx` ON `batch`(`cutoffAt`);

-- CreateIndex
CREATE UNIQUE INDEX `batch_scheduleId_cutoffAt_part_key` ON `batch`(`scheduleId`, `cutoffAt`, `part`);

-- AddForeignKey
ALTER TABLE `batch` ADD CONSTRAINT `batch_scheduleId_fkey` FOREIGN KEY (`scheduleId`) REFERENCES `batchschedule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `batch` ADD CONSTRAINT `batch_partOfId_fkey` FOREIGN KEY (`partOfId`) REFERENCES `batch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `batchschedule` ADD CONSTRAINT `batchschedule_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

