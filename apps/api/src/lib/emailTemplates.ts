import {
  DEFAULT_BRANDING_ACCENT, DEFAULT_TEMPLATES, TEMPLATE_KEYS, TEMPLATE_META, fillPlaceholders,
  type EmailBranding, type EmailTemplate, type TemplateKey, type TemplateView,
} from '@reimsis/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { isPublicLink } from './email.js';

/** Content-ID of the logo that is attached to every email, so it shows without the reader having to allow remote images. */
export const LOGO_CID = 'logo@reimsys';

const TEMPLATES_KEY = 'email.templates';
const BRANDING_KEY = 'email.branding';

/* ---------- storage: the administrator's edits sit on top of the built-in defaults ---------- */

let cache: { at: number; overrides: Partial<Record<TemplateKey, EmailTemplate>>; branding: EmailBranding } | null = null;
export const invalidateTemplateCache = () => { cache = null; };

const defaultBranding = (): EmailBranding => ({ orgName: config.orgName, footer: '', accent: DEFAULT_BRANDING_ACCENT });

async function load() {
  if (cache && Date.now() - cache.at < 15_000) return cache;
  const rows = await prisma.setting.findMany({ where: { key: { in: [TEMPLATES_KEY, BRANDING_KEY] } } });
  const parse = <T,>(k: string, fallback: T): T => {
    const r = rows.find((x) => x.key === k);
    if (!r) return fallback;
    try { return JSON.parse(r.value) as T; } catch { return fallback; }
  };
  cache = {
    at: Date.now(),
    overrides: parse<Partial<Record<TemplateKey, EmailTemplate>>>(TEMPLATES_KEY, {}),
    branding: { ...defaultBranding(), ...parse<Partial<EmailBranding>>(BRANDING_KEY, {}) },
  };
  return cache;
}

export async function getBranding(): Promise<EmailBranding> {
  return (await load()).branding;
}

export async function getTemplate(key: TemplateKey): Promise<EmailTemplate> {
  const { overrides } = await load();
  return { ...DEFAULT_TEMPLATES[key], ...overrides[key] };
}

export async function templateViews(): Promise<TemplateView[]> {
  const { overrides } = await load();
  return TEMPLATE_KEYS.map((key) => ({
    key, ...TEMPLATE_META[key],
    template: { ...DEFAULT_TEMPLATES[key], ...overrides[key] },
    defaults: DEFAULT_TEMPLATES[key],
    isCustom: !!overrides[key],
  }));
}

async function writeSetting(key: string, value: unknown, userId: number) {
  await prisma.setting.upsert({ where: { key }, update: { value: JSON.stringify(value), updatedById: userId }, create: { key, value: JSON.stringify(value), updatedById: userId } });
  invalidateTemplateCache();
}

export async function saveTemplate(key: TemplateKey, t: EmailTemplate, userId: number) {
  const { overrides } = await load();
  await writeSetting(TEMPLATES_KEY, { ...overrides, [key]: t }, userId);
}

export async function resetTemplate(key: TemplateKey, userId: number) {
  const { overrides } = await load();
  const next = { ...overrides };
  delete next[key];
  await writeSetting(TEMPLATES_KEY, next, userId);
}

export async function saveBranding(b: EmailBranding, userId: number) {
  await writeSetting(BRANDING_KEY, b, userId);
}

/* ---------- rendering ---------- */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

type Block = { kind: 'p'; lines: string[] } | { kind: 'quote'; lines: string[] };

/** Splits the message into paragraphs and highlighted notes. A note with nothing in it (for example no reason was written) is dropped. */
function toBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const raw of body.replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    const last = blocks[blocks.length - 1];
    if (!line.trim()) { blocks.push({ kind: 'p', lines: [] }); continue; }
    if (/^>\s?/.test(line)) {
      const text = line.replace(/^>\s?/, '').trim();
      if (last?.kind === 'quote') last.lines.push(text); else blocks.push({ kind: 'quote', lines: [text] });
    } else if (last?.kind === 'p') last.lines.push(line.trim());
    else blocks.push({ kind: 'p', lines: [line.trim()] });
  }
  return blocks
    .map((b) => (b.kind === 'quote' ? { ...b, lines: b.lines.filter(Boolean) } : { ...b, lines: b.lines.filter((l) => l !== undefined) }))
    .filter((b) => b.lines.length && b.lines.join('').trim());
}

export interface RenderInput {
  key: TemplateKey;
  data: Record<string, string | undefined>;
  /** Where the button goes. It is dropped (with a sentence instead) when the address would look like spam. */
  link?: string;
  /** Render this instead of the saved template, for previews of unsaved edits. */
  template?: EmailTemplate;
  branding?: EmailBranding;
}

export interface Rendered { subject: string; html: string; text: string }

export async function renderEmail(input: RenderInput): Promise<Rendered> {
  const t = input.template ?? (await getTemplate(input.key));
  const b = input.branding ?? (await getBranding());
  const data: Record<string, string | undefined> = { ...input.data, orgName: b.orgName };
  const fill = (s: string) => fillPlaceholders(s, data);

  const subject = fill(t.subject).replace(/\s+/g, ' ').trim();
  const heading = fill(t.heading).replace(/\s+/g, ' ').trim();
  const blocks = toBlocks(fill(t.body));
  const buttonLabel = fill(t.buttonLabel).trim();
  const linkOk = !!input.link && isPublicLink(input.link);
  const showButton = !!buttonLabel && linkOk;
  const needsSignInLine = !!buttonLabel && !!input.link && !linkOk;
  if (needsSignInLine) blocks.push({ kind: 'p', lines: [`Sign in to ${data.orgName} to open it.`] });

  const meta = TEMPLATE_META[input.key];
  const details: [string, string][] = [];
  if (t.showDetails && meta.hasReceipt) {
    for (const [label, key] of [['Receipt', 'refNo'], ['Paid to', 'payee'], ['Amount', 'amount'], ['Category', 'category'], ['Receipt date', 'date'], ['Status', 'status'], ['Document', 'docNo']] as const) {
      if (data[key]) details.push([label, data[key]!]);
    }
  }

  const accent = b.accent;
  const preheader = blocks.find((x) => x.kind === 'p')?.lines.join(' ').slice(0, 110) ?? '';
  const footerLines = [b.footer, `This is an automated message from ${data.orgName}. Please do not reply to it.`].filter(Boolean);

  const bodyHtml = blocks.map((x) => x.kind === 'quote'
    ? `<div style="margin:14px 0;padding:12px 16px;background:#f1f6f6;border-left:4px solid ${accent};border-radius:0 8px 8px 0;font-size:15px;line-height:1.55;color:#12232b">${x.lines.map(esc).join('<br>')}</div>`
    : `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#2b3d45">${x.lines.map(esc).join('<br>')}</p>`).join('');

  const detailsHtml = details.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 6px;border:1px solid #e0e7ea;border-radius:10px;border-collapse:separate;overflow:hidden">${details.map(([k, v], i) => `<tr><td style="padding:9px 14px;width:34%;font-size:13px;color:#5a6d76;${i ? 'border-top:1px solid #e0e7ea;' : ''}background:#fafcfc">${esc(k)}</td><td style="padding:9px 14px;font-size:14px;font-weight:600;color:#12232b;${i ? 'border-top:1px solid #e0e7ea;' : ''}">${esc(v)}</td></tr>`).join('')}</table>`
    : '';

  const buttonHtml = showButton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td style="background:${accent};border-radius:8px"><a href="${esc(input.link!)}" style="display:inline-block;padding:12px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none">${esc(buttonLabel)}</a></td></tr></table>`
    : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f7f8;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f7f8">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e0e7ea;border-radius:12px;overflow:hidden">
<tr><td style="height:5px;background:${accent};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:22px 28px 0"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="34" height="34" style="width:34px;height:34px"><img src="cid:${LOGO_CID}" width="34" height="34" alt="${esc(String(data.orgName))}" style="display:block;border:0"></td><td style="padding-left:10px;font-size:14px;font-weight:700;letter-spacing:.05em;color:${accent}">${esc(String(data.orgName).toUpperCase())}</td></tr></table></td></tr>
<tr><td style="padding:10px 28px 4px"><h1 style="margin:0;font-size:22px;line-height:1.3;color:#12232b">${esc(heading)}</h1></td></tr>
<tr><td style="padding:12px 28px 8px">${bodyHtml}${detailsHtml}${buttonHtml}</td></tr>
<tr><td style="padding:18px 28px 24px"><div style="border-top:1px solid #e0e7ea;padding-top:14px;font-size:12px;line-height:1.6;color:#7a8c94">${footerLines.map(esc).join('<br>')}</div></td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    heading, '',
    ...blocks.flatMap((x) => (x.kind === 'quote' ? [...x.lines.map((l) => `> ${l}`), ''] : [...x.lines, ''])),
    ...(details.length ? [...details.map(([k, v]) => `${k}: ${v}`), ''] : []),
    ...(showButton ? [`${buttonLabel}: ${input.link}`, ''] : []),
    '--', ...footerLines,
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { subject, html, text };
}

/** Values every email about a receipt can use. */
export function receiptData(r: { refNo: string; payee: string; amount: number | string; status: string; receiptDate: string; category: string }, extra: { actorName?: string; note?: string | null; docNo?: string | null }): Record<string, string> {
  const d = new Date(r.receiptDate + 'T00:00:00Z');
  return {
    refNo: r.refNo, payee: r.payee, category: r.category,
    amount: 'PHP ' + Number(r.amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    date: d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }),
    status: r.status.charAt(0).toUpperCase() + r.status.slice(1),
    actorName: extra.actorName ?? '', note: extra.note ?? '', docNo: extra.docNo ?? '',
  };
}
