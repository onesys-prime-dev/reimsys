import { describe, expect, it } from 'vitest';
import { htmlToText, isPublicLink, renderHtml } from '../src/lib/email';

describe('links in emails', () => {
  it('only allows normal https addresses', () => {
    expect(isPublicLink('https://reimsis.example.com/receipts/4')).toBe(true);
    expect(isPublicLink('http://reimsis.example.com')).toBe(false);
    expect(isPublicLink('http://192.168.1.39:4000/receipts/4')).toBe(false);
    expect(isPublicLink('https://192.168.1.39')).toBe(false);
    expect(isPublicLink('http://localhost:4000')).toBe(false);
    expect(isPublicLink('https://reimsis.local')).toBe(false);
    expect(isPublicLink('not a url')).toBe(false);
  });

  it('leaves out the button for a link that looks like spam and says how to open it instead', () => {
    const html = renderHtml('Receipt approved', ['Done.'], { url: 'http://192.168.1.39:4000/receipts/9', label: 'Open the record' });
    expect(html).not.toContain('192.168.1.39');
    expect(html).not.toContain('<a ');
    expect(html).toContain('Sign in to');
  });

  it('keeps the button for a proper https link', () => {
    const html = renderHtml('Receipt approved', ['Done.'], { url: 'https://reimsis.example.com/receipts/9', label: 'Open the record' });
    expect(html).toContain('href="https://reimsis.example.com/receipts/9"');
    expect(html).not.toContain('Sign in to');
  });
});

describe('plain-text version', () => {
  it('turns the html into readable text with the link spelled out', () => {
    const text = htmlToText(renderHtml('Receipt returned', ['Liza returned RC-1 (Mercury & Sons).', 'Note: blurry photo'], { url: 'https://reimsis.example.com/receipts/2', label: 'Open the record' }));
    expect(text).toContain('Receipt returned');
    expect(text).toContain('Liza returned RC-1 (Mercury & Sons).');
    expect(text).toContain('Note: blurry photo');
    expect(text).toContain('Open the record: https://reimsis.example.com/receipts/2');
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text).not.toContain('&amp;');
  });
});

import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { buildMessage } from '../src/lib/email';

describe('the message a receiving mail server sees', () => {
  it('has both html and plain text, honest automated-mail headers, and an id on the sender domain', async () => {
    const html = renderHtml('Email is working', ['This is a test message.'], { url: 'http://192.168.1.39:4000', label: 'Open REIMSIS' });
    const msg = buildMessage({ id: 7, from: '"REIMSIS" <you@gmail.com>', to: 'someone@example.com', subject: 'REIMSIS: test email', html });
    const sent = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(msg);
    const parsed = await simpleParser(sent.message as Buffer);
    expect(parsed.html).toBeTruthy();
    expect(parsed.text).toContain('This is a test message.');
    expect(parsed.messageId).toMatch(/^<[0-9a-f-]+@gmail\.com>$/);
    expect(parsed.headers.get('auto-submitted')).toBe('auto-generated');
    expect(parsed.from?.text).toContain('you@gmail.com');
    // a raw-IP link is what spam filters punish, so it must be absent from both versions
    expect(String(parsed.html)).not.toContain('192.168');
    expect(String(parsed.text)).not.toContain('192.168');
  });
});
