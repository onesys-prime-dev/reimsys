-- Run once as a MySQL administrator AFTER migrations. Replace the password.
-- The running app connects as reimsys_app. It can read and write every table except the audit trail,
-- which it can only read and append to. Changing or deleting audit rows needs a person with database access.
--
-- MySQL cannot take one privilege away from a database-wide grant, so the grants are per table.
-- If a later migration adds a table, grant it here too (SELECT, INSERT, UPDATE, DELETE).

CREATE USER IF NOT EXISTS 'reimsys_app'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.Role                  TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.Permission            TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.RolePermission        TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.User                  TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.Session               TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.Category              TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.Receipt               TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.ReceiptEvidence       TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.ReimbursementDocument TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.Notification          TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.EmailLog              TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.Job                   TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.LiquidationReport     TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.ImportJob             TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.Comment               TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.PasswordToken          TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.Setting               TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.Sequence              TO 'reimsys_app'@'localhost';

-- Audit log: read and append only.
GRANT SELECT, INSERT ON reimsys.AuditLog TO 'reimsys_app'@'localhost';

FLUSH PRIVILEGES;

-- The app never deletes users (it deactivates them), so the ON DELETE SET NULL rule on AuditLog.actorId is never exercised.
