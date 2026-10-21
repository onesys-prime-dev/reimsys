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
  });
  it('compares against the version given when the notice version is a setting', () => {
    expect(needsPrivacy(1, 2)).toBe(true);
    expect(needsPrivacy(2, 2)).toBe(false);
    expect(needsPrivacy(null, 1)).toBe(true);
    expect(needsPrivacy(5, 3)).toBe(false);
  });
});
