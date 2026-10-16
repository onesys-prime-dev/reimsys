import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, SAMPLE_DATA, TEMPLATE_KEYS, sampleFor, type EmailBranding } from '@reimsys/shared';
import { buildMessage, htmlToText, isPublicLink, isReservedAddress } from '../src/lib/email';
import { renderEmail } from '../src/lib/emailTemplates';
import { paidEmailData } from '../src/lib/paymentNotices';

const branding: EmailBranding = { orgName: 'Test Pharmacy', footer: 'Cebu City', accent: '#0c7480' };
const HTTPS = 'https://reimsys.example.com/receipts/9';
const render = (key: keyof typeof DEFAULT_TEMPLATES, data: Record<string, string>, link?: string, template = DEFAULT_TEMPLATES[key]) =>
  renderEmail({ key, data, link, template, branding });

describe('links in emails', () => {
  it('only allows normal https addresses', () => {
    expect(isPublicLink(HTTPS)).toBe(true);
    expect(isPublicLink('http://reimsys.example.com')).toBe(false);
    expect(isPublicLink('http://192.168.1.39:4000/receipts/4')).toBe(false);
    expect(isPublicLink('https://192.168.1.39')).toBe(false);
    expect(isPublicLink('http://localhost:4000')).toBe(false);
    expect(isPublicLink('https://reimsys.local')).toBe(false);
    expect(isPublicLink('not a url')).toBe(false);
  });

  it('shows the button for a proper https link', async () => {
    const m = await render('returned', SAMPLE_DATA, HTTPS);
    expect(m.html).toContain(`href="${HTTPS}"`);
    expect(m.html).toContain('Open the receipt');
    expect(m.text).toContain(`Open the receipt: ${HTTPS}`);
  });

  it('leaves the button out for a link that looks like spam and says how to open it instead', async () => {
    const m = await render('returned', SAMPLE_DATA, 'http://192.168.1.39:4000/receipts/9');
    expect(m.html).not.toContain('192.168');
    expect(m.html).not.toContain('<a ');
    expect(m.html).toContain('Sign in to Test Pharmacy to open it.');
    expect(m.text).not.toContain('192.168');
  });
});

describe('example addresses', () => {
  it('are recognised as never deliverable', () => {
    for (const a of ['ana.reyes@example.com', 'x@example.org', 'x@EXAMPLE.NET', 'x@reimsys.test', 'x@foo.invalid', 'x@localhost', 'x@mail.example.com']) expect(isReservedAddress(a), a).toBe(true);
  });
  it('do not catch real addresses', () => {
    for (const a of ['someone@gmail.com', 'ana@mypharmacy.ph', 'x@examples.com', 'x@counterexample.com', 'x@testing.com']) expect(isReservedAddress(a), a).toBe(false);
  });
});

describe('filling in a template', () => {
  it('replaces placeholders in the subject, heading and message', async () => {
    const m = await render('returned', { ...SAMPLE_DATA, refNo: 'RC-2026-000777', recipientName: 'Ana' });
    expect(m.subject).toBe('RC-2026-000777 needs a correction');
    expect(m.html).toContain('Hi Ana,');
    expect(m.html).toContain('RC-2026-000777');
  });

  it('cannot be tricked by html or scripts in the values', async () => {
    const m = await render('returned', { ...SAMPLE_DATA, payee: '<script>alert(1)</script>', note: '<img src=x onerror=alert(1)>' });
    expect(m.html).not.toContain('<script>alert');
    expect(m.html).not.toContain('<img src=x');
    expect(m.html).toContain('&lt;script&gt;');
  });

  it('shows what was written as a highlighted note, and drops the box when nothing was written', async () => {
    const withNote = await render('returned', { ...SAMPLE_DATA, note: 'Photo is blurry.' });
    expect(withNote.html).toContain('border-left:4px solid #0c7480');
    expect(withNote.html).toContain('Photo is blurry.');
    const without = await render('approved', { ...SAMPLE_DATA, note: '' });
    expect(without.html).not.toContain('border-left:4px solid');
  });

  it('never leaves a raw {{placeholder}} behind', async () => {
    const m = await render('returned', { refNo: 'RC-1' }, undefined, { ...DEFAULT_TEMPLATES.returned, body: 'Hello {{nonsense}} and {{refNo}}.' });
    expect(m.html).not.toContain('{{');
    expect(m.html).toContain('and RC-1.');
  });

  it('uses the organisation name, footer and colour from the branding', async () => {
    const m = await render('test', { actorName: 'Admin' }, HTTPS);
    expect(m.html).toContain('TEST PHARMACY');
    expect(m.html).toContain('Cebu City');
    expect(m.html).toContain('background:#0c7480');
    expect(m.text).toContain('Cebu City');
  });
});

describe('receipt details table', () => {
  it('is included when the template asks for it and the email is about a receipt', async () => {
    const m = await render('approved', SAMPLE_DATA, HTTPS);
    expect(m.html).toContain('Paid to');
    expect(m.html).toContain('PHP 1,284.50');
    expect(m.text).toContain('Amount: PHP 1,284.50');
  });

  it('can be switched off', async () => {
    const m = await render('approved', SAMPLE_DATA, HTTPS, { ...DEFAULT_TEMPLATES.approved, showDetails: false });
    expect(m.html).not.toContain('Paid to');
  });

  it('is never added to emails that are not about a receipt', async () => {
    const m = await render('digest', { recipientName: 'Ana', summary: '• 2 receipts waiting.' }, HTTPS, { ...DEFAULT_TEMPLATES.digest, showDetails: true });
    expect(m.html).not.toContain('Paid to');
  });
});

describe('daily summary', () => {
  it('lists what is waiting, one line each', async () => {
    const m = await render('digest', { recipientName: 'Liza', summary: '• 3 receipts waiting to be checked.\n• 1 draft not submitted yet.' }, HTTPS);
    expect(m.html).toContain('Good morning, Liza');
    expect(m.html).toContain('3 receipts waiting to be checked.');
    expect(m.text).toContain('• 1 draft not submitted yet.');
  });
});

describe('plain-text version', () => {
  it('has no tags or entities left in it', () => {
    const text = htmlToText('<h2>Hi &amp; welcome</h2><p>Line one<br>Line two</p><a href="https://x.example/a">Open</a>');
    expect(text).toContain('Hi & welcome');
    expect(text).toContain('Open: https://x.example/a');
    expect(text).not.toMatch(/<[a-z]/i);
  });
});

describe('the message a receiving mail server sees', () => {
  it('has html and plain text, honest automated-mail headers, and an id on the sender domain', async () => {
    const mail = await render('test', { actorName: 'Admin' }, 'http://192.168.1.39:4000');
    const msg = buildMessage({ id: 7, from: '"REIMSYS" <you@gmail.com>', to: 'someone@example.com', subject: mail.subject, html: mail.html });
    const sent = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(msg);
    const parsed = await simpleParser(sent.message as Buffer);
    expect(parsed.html).toBeTruthy();
    expect(parsed.text).toContain('If you can read this');
    expect(parsed.messageId).toMatch(/^<[0-9a-f-]+@gmail\.com>$/);
    expect(parsed.headers.get('auto-submitted')).toBe('auto-generated');
    expect(String(parsed.html)).not.toContain('192.168');
  });

  it('carries the logo as an inline image so it shows without allowing remote images', async () => {
    const mail = await render('test', { actorName: 'Admin' }, HTTPS);
    expect(mail.html).toContain('src="cid:logo@reimsys"');
    const msg = buildMessage({ id: 8, from: 'REIMSYS <you@gmail.com>', to: 'someone@example.com', subject: mail.subject, html: mail.html });
    const sent = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(msg);
    const parsed = await simpleParser(sent.message as Buffer);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]!.cid).toBe('logo@reimsys');
    expect(parsed.attachments[0]!.contentType).toBe('image/png');
    expect(parsed.attachments[0]!.size).toBeGreaterThan(500);
  });
});

describe('sample previews fit the email they belong to', () => {
  it('a returned email never looks approved', async () => {
    const m = await render('returned', sampleFor('returned'), HTTPS);
    expect(m.html).toContain('Returned');
    expect(m.html).not.toContain('REIM-2026');
    expect(m.html).not.toContain('Document</td>');
  });
  it('an approved email shows its document number', async () => {
    const m = await render('approved', sampleFor('approved'), HTTPS);
    expect(m.html).toContain('REIM-2026-000045');
  });
  it('every email renders without a leftover placeholder or an empty highlighted box', async () => {
    for (const key of TEMPLATE_KEYS) {
      const m = await render(key, sampleFor(key), HTTPS);
      expect(m.html, key).not.toContain('{{');
      expect(m.subject, key).toBeTruthy();
      expect(m.text, key).not.toContain('{{');
    }
  });
});

describe('payment emails', () => {
  it('the paid email lists every receipt, the method and the total, and escapes what people typed', async () => {
    const data = paidEmailData({ paymentNo: 'PAY-2026-000007', method: 'GCash <b>', paidOn: '2026-10-15', actorName: 'Rica Tan' }, [
      { id: 1, refNo: 'RC-2026-000001', payee: 'Mercury <script>', amount: 1284.5, paid: 1284.5 },
      { id: 2, refNo: 'RC-2026-000002', payee: 'Shell', amount: 700, paid: 600 },
    ]);
    const m = await render('paid', { ...data, recipientName: 'Ana' }, HTTPS);
    expect(m.subject).toBe('Payment sent: PAY-2026-000007');
    expect(m.text).toContain('RC-2026-000001 · Mercury <script> · PHP 1,284.50');
    expect(m.text).toContain('RC-2026-000002 · Shell · PHP 600.00 (receipt PHP 700.00)');
    expect(m.text).toContain('PHP 1,884.50');
    expect(m.text).toContain('Oct 15, 2026');
    expect(m.html).not.toContain('<script>');
    expect(m.html).toContain('Mercury &lt;script&gt;');
    expect(m.html).toContain('GCash &lt;b&gt;');
  });
  it('the reversal email names the payment and the reason', async () => {
    const s = sampleFor('payment_reversed');
    const m = await render('payment_reversed', s, HTTPS);
    expect(m.subject).toContain(s.refNo);
    expect(m.text).toContain(s.paymentNo);
    expect(m.text).toContain(s.note);
  });
});
