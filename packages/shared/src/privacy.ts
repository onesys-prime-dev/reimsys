/**
 * The privacy notice everyone must accept once after signing in. Raise the number whenever the wording changes in a way people
 * should read again: everyone is then asked to accept again at their next sign-in. The text itself is in apps/web/src/pages/Privacy.tsx.
 */
export const PRIVACY_VERSION = 1;

/** True when this person has not accepted the current version of the notice. */
export const needsPrivacy = (acceptedVersion: number | null | undefined, currentVersion: number = PRIVACY_VERSION): boolean => (acceptedVersion ?? 0) < Math.max(currentVersion, PRIVACY_VERSION);

/** The version in force: the one in the code, or the one an administrator raised it to in Settings, whichever is higher. */
export const privacyVersionIn = (settingsVersion: number | null | undefined): number => Math.max(PRIVACY_VERSION, settingsVersion ?? 0);
