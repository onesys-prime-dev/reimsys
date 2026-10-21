import { describe, expect, it } from 'vitest';
import { PRIVACY_VERSION, needsPrivacy } from '../src/privacy';

describe('privacy notice acceptance', () => {
  it('asks people who never accepted', () => {
    expect(needsPrivacy(null)).toBe(true);
    expect(needsPrivacy(undefined)).toBe(true);
  });
  it('asks again when the notice has a newer version', () => {
    expect(needsPrivacy(PRIVACY_VERSION - 1)).toBe(true);
  });
  it('does not ask once the current version is accepted', () => {
    expect(needsPrivacy(PRIVACY_VERSION)).toBe(false);
    expect(needsPrivacy(PRIVACY_VERSION + 1)).toBe(false);
    // an administrator raising the version in Settings asks everyone to accept again
    expect(needsPrivacy(PRIVACY_VERSION, PRIVACY_VERSION + 1)).toBe(true);
    expect(needsPrivacy(PRIVACY_VERSION + 1, PRIVACY_VERSION + 1)).toBe(false);
    // a setting below the version in the code never lowers the bar
    expect(needsPrivacy(PRIVACY_VERSION, 0)).toBe(false);
  });
});
