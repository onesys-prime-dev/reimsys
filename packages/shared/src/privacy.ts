/**
 * The privacy notice everyone must accept once after signing in. Raise the number whenever the wording changes in a way people
 * should read again: everyone is then asked to accept again at their next sign-in. The text itself is in apps/web/src/pages/Privacy.tsx.
 */
export const PRIVACY_VERSION = 1;

/** True when this person has not accepted the current version of the notice. */
export const needsPrivacy = (acceptedVersion: number | null | undefined): boolean => (acceptedVersion ?? 0) < PRIVACY_VERSION;
