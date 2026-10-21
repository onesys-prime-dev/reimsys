/**
 * The privacy notice everyone must accept once after signing in. This is the starting version; the live one is a setting (Access → Settings →
 * Privacy notice), and raising it makes everyone accept again at their next action. The wording is in apps/web/src/pages/Privacy.tsx; the two blanks
 * (how long records are kept, who to contact) are settings too.
 */
export const PRIVACY_VERSION = 1;

/** True when this person has not accepted the current version of the notice. */
export const needsPrivacy = (acceptedVersion: number | null | undefined, currentVersion: number = PRIVACY_VERSION): boolean => (acceptedVersion ?? 0) < currentVersion;
