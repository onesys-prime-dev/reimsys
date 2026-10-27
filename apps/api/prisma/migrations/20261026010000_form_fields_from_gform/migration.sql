-- AlterTable
ALTER TABLE `receipt` ADD COLUMN `chargeLocationId` INTEGER NULL,
    ADD COLUMN `detailsReviewed` BOOLEAN NULL,
    ADD COLUMN `discountAmount` DECIMAL(12, 2) NULL,
    ADD COLUMN `newReimbursementCode` BOOLEAN NULL,
    ADD COLUMN `reimbursementCode` VARCHAR(40) NULL,
    ADD COLUMN `vatExemptAmount` DECIMAL(12, 2) NULL;

-- CreateTable
CREATE TABLE `charge_location` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(120) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `charge_location_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `receipt` ADD CONSTRAINT `receipt_chargeLocationId_fkey` FOREIGN KEY (`chargeLocationId`) REFERENCES `charge_location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- The places a receipt can be charged to (an administrator edits this list in Settings).
INSERT INTO `charge_location` (`name`, `sortOrder`) VALUES
    ('Makati Medical Center', 1),
    ('Solara Pharma Corp.', 2),
    ('St. Lukes Medical Center - Quezon City', 3),
    ('St. Lukes Medical Center - Taguig', 4);

-- The classification list changed: "Meal" is now "Meal - Personal" and "Representation" is now "Representation - Meal".
UPDATE `receipt` SET `classification` = 'meal_personal' WHERE `classification` = 'meal';
UPDATE `receipt` SET `classification` = 'representation_meal' WHERE `classification` = 'representation';
