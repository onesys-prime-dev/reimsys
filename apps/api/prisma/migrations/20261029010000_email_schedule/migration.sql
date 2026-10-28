-- CreateTable
CREATE TABLE `email_schedule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(80) NOT NULL,
    `isOn` BOOLEAN NOT NULL DEFAULT true,
    `steps` VARCHAR(40) NOT NULL,
    `minDays` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    `roleIds` VARCHAR(200) NOT NULL DEFAULT '',
    `userIds` VARCHAR(1000) NOT NULL DEFAULT '',
    `intervalMinutes` INTEGER NOT NULL,
    `startTime` VARCHAR(5) NOT NULL,
    `endTime` VARCHAR(5) NOT NULL,
    `days` VARCHAR(20) NOT NULL,
    `timeZone` VARCHAR(60) NOT NULL,
    `lastSentAt` DATETIME(3) NULL,
    `lastCount` INTEGER NOT NULL DEFAULT 0,
    `createdById` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
