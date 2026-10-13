import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TEMPLATES, PLACEHOLDERS, TEMPLATE_KEYS, TEMPLATE_META, emailBrandingSchema, emailTemplateSchema, fillPlaceholders, placeholdersIn, unknownPlaceholders,
} from '../src/index';

describe('placeholders', () => {
  it('fills known values and turns missing ones into empty text', () => {
    expect(fillPlaceholders('Hi {{name}}, {{ refNo }} is {{missing}}.', { name: 'Ana', refNo: 'RC-1' })).toBe('Hi Ana, RC-1 is .');
  });
  it('finds the ones used in a text', () => {
    expect(placeholdersIn('{{a}} and {{ b }} and {{a}}')).toEqual(['a', 'b', 'a']);
  });
  it('flags placeholders an email does not have', () => {
    const t = { ...DEFAULT_TEMPLATES.returned, body: 'See {{docNo}} and {{bogus}}' };
    expect(unknownPlaceholders(t, 'returned')).toEqual(['docNo', 'bogus']);
    expect(unknownPlaceholders({ ...t, body: 'See {{docNo}}' }, 'approved')).toEqual([]);
  });
});

describe('the built-in templates', () => {
  it('exist for every email and only use placeholders that email has', () => {
    for (const key of TEMPLATE_KEYS) {
      expect(DEFAULT_TEMPLATES[key]).toBeTruthy();
      expect(unknownPlaceholders(DEFAULT_TEMPLATES[key], key), key).toEqual([]);
      expect(emailTemplateSchema.safeParse(DEFAULT_TEMPLATES[key]).success, key).toBe(true);
    }
  });
  it('only allow placeholders that are defined', () => {
    const defined = new Set(PLACEHOLDERS.map((p) => p.key));
    for (const key of TEMPLATE_KEYS) for (const a of TEMPLATE_META[key].allowed) expect(defined.has(a), `${key}:${a}`).toBe(true);
  });
});

describe('validation of an edited template', () => {
  const ok = DEFAULT_TEMPLATES.returned;
  it('refuses an empty subject, heading or message', () => {
    expect(emailTemplateSchema.safeParse({ ...ok, subject: ' ' }).success).toBe(false);
    expect(emailTemplateSchema.safeParse({ ...ok, heading: '' }).success).toBe(false);
    expect(emailTemplateSchema.safeParse({ ...ok, body: '' }).success).toBe(false);
  });
  it('allows an empty button label, meaning no button', () => {
    expect(emailTemplateSchema.safeParse({ ...ok, buttonLabel: '' }).success).toBe(true);
  });
  it('limits the length', () => {
    expect(emailTemplateSchema.safeParse({ ...ok, subject: 'x'.repeat(151) }).success).toBe(false);
    expect(emailTemplateSchema.safeParse({ ...ok, body: 'x'.repeat(2001) }).success).toBe(false);
  });
  it('checks the brand colour', () => {
    expect(emailBrandingSchema.safeParse({ orgName: 'A', footer: '', accent: '#0c7480' }).success).toBe(true);
    expect(emailBrandingSchema.safeParse({ orgName: 'A', footer: '', accent: 'teal' }).success).toBe(false);
    expect(emailBrandingSchema.safeParse({ orgName: '', footer: '', accent: '#0c7480' }).success).toBe(false);
  });
});
