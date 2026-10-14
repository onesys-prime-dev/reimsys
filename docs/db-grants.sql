-- Run once as a MySQL administrator AFTER migrations. Replace the password.
-- The running app connects as reimsis_app. It can read and write every table except the audit trail,
-- which it can only read and append to. Changing or deleting audit rows needs a person with database access.
--
-- MySQL cannot take one privilege away from a database-wide grant, so the grants are per table.
-- If a later migration adds a table, grant it here too (SELECT, INSERT, UPDATE, DELETE).

CREATE USER IF NOT EXISTS 'reimsis_app'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.Role                  TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.Permission            TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.RolePermission        TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.User                  TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.Session               TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.Category              TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.Receipt               TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.ReceiptEvidence       TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.ReimbursementDocument TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.Notification          TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.EmailLog              TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.Job                   TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.LiquidationReport     TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.ImportJob             TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.Comment               TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.Setting               TO 'reimsis_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsis.Sequence              TO 'reimsis_app'@'localhost';

-- Audit log: read and append only.
GRANT SELECT, INSERT ON reimsis.AuditLog TO 'reimsis_app'@'localhost';

FLUSH PRIVILEGES;

-- The app never deletes users (it deactivates them), so the ON DELETE SET NULL rule on AuditLog.actorId is never exercised.
