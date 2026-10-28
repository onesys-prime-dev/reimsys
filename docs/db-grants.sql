-- Run once as a MySQL administrator AFTER migrations. Replace the password.
-- The running app connects as reimsys_app. It can read and write every table except the audit trail,
-- which it can only read and append to. Changing or deleting audit rows needs a person with database access.
--
-- MySQL cannot take one privilege away from a database-wide grant, so the grants are per table.
-- If a later migration adds a table, grant it here too (SELECT, INSERT, UPDATE, DELETE).

CREATE USER IF NOT EXISTS 'reimsys_app'@'localhost' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.role                  TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.permission            TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.rolepermission        TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.user                  TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.session               TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.category              TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.receipt               TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.receiptevidence       TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.reimbursementdocument TO 'reimsys_app'@'localhost';
-- Payments are written once and never edited or deleted (a reversal clears the link on the receipt, the payment row stays).
GRANT SELECT, INSERT ON reimsys.payment TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.notification          TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.emaillog              TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.job                   TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.liquidationreport     TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.importjob             TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.comment               TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.passwordtoken          TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.setting               TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.sequence              TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.charge_location       TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.form_draft            TO 'reimsys_app'@'localhost';
GRANT SELECT, INSERT, UPDATE, DELETE ON reimsys.email_schedule        TO 'reimsys_app'@'localhost';

-- Audit log: read and append only.
GRANT SELECT, INSERT ON reimsys.auditlog TO 'reimsys_app'@'localhost';

FLUSH PRIVILEGES;

-- The app never deletes users (it deactivates them), so the ON DELETE SET NULL rule on AuditLog.actorId is never exercised.
