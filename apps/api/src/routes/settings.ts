import { Router, type RequestHandler } from 'express';
import nodemailer from 'nodemailer';
import {
  PLACEHOLDERS, TEMPLATE_KEYS, sampleFor, TEMPLATE_META, emailBrandingSchema, emailTemplateSchema, mailSettingsSchema, unknownPlaceholders,
  type EmailTemplate, type TemplateKey,
} from '@reimsys/shared';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { explainMailError, isPublicLink, queueEmail } from '../lib/email.js';
import { EMAIL_LOGO_PNG_BASE64 } from '../lib/emailLogo.js';
import { LOGO_CID, getBranding, getTemplate, renderEmail, resetTemplate, saveBranding, saveTemplate, templateViews } from '../lib/emailTemplates.js';
import { badRequest, notFound } from '../lib/errors.js';
import { diagnoseMail } from '../lib/mailDiagnose.js';
import { clearMail, mailView, resolveMail, saveMail, savedPassword } from '../lib/mailSettings.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requirePerm('settings.manage'));

settingsRouter.get('/mail', async (_req, res) => {
  res.json({ mail: await mailView() });
});

settingsRouter.put('/mail', async (req, res) => {
  const input = mailSettingsSchema.parse(req.body);
  const before = await mailView();
  await saveMail(input, req.auth!.user.id);
  // The password itself is never written to the audit log, only whether it changed.
  await audit(req, {
    action: 'settings.mail_saved', entityType: 'settings', entityId: 'mail', summary: `saved the mail account (${input.host}:${input.port})`,
    before: { host: before.host, port: before.port, user: before.user, fromAddress: before.fromAddress, testRedirect: before.testRedirect },
    after: { host: input.host, port: input.port, secure: input.secure, user: input.user, fromAddress: input.fromAddress, testRedirect: input.testRedirect, passwordChanged: !!input.pass },
  });
  res.json({ mail: await mailView() });
});

/** Opens a connection and signs in, without sending anything. Uses the form's values, so it works before saving. */
settingsRouter.post('/mail/verify', async (req, res) => {
  const input = mailSettingsSchema.parse(req.body);
  const pass = input.pass ? input.pass : await savedPassword();
  const transport = nodemailer.createTransport({
    host: input.host, port: input.port, secure: input.secure, auth: input.user ? { user: input.user, pass } : undefined,
    connectionTimeout: 8_000, greetingTimeout: 8_000, socketTimeout: 10_000,
  });
  try {
    await transport.verify();
    res.json({ ok: true, message: 'Connected and signed in. Save these settings, then send a test email.' });
  } catch (err) {
    res.json({ ok: false, message: explainMailError(err) });
  } finally {
    transport.close();
  }
});

/** Looks at every step of sending (account, key, name, ports, login) and says which one fails. Sends nothing. */
const runMailCheck: RequestHandler = async (req, res) => {
  const result = await diagnoseMail();
  await audit(req, { action: 'settings.mail_checked', entityType: 'settings', entityId: 'mail', summary: result.ok ? 'ran the mail check: all steps passed' : `ran the mail check: ${result.steps.filter((s) => s.state === 'fail').map((s) => s.id).join(', ')} failed` });
  res.json(result);
};
// The button uses POST; GET also works so the link opened in a browser shows the result instead of "Not found".
settingsRouter.post('/mail/diagnose', runMailCheck);
settingsRouter.get('/mail/diagnose', runMailCheck);

settingsRouter.delete('/mail', async (req, res) => {
  await clearMail();
  await audit(req, { action: 'settings.mail_cleared', entityType: 'settings', entityId: 'mail', summary: 'removed the saved mail account' });
  res.json({ mail: await mailView() });
});

settingsRouter.get('/mail/status', async (_req, res) => {
  const m = await resolveMail();
  res.json({ configured: !!m.smtp, source: m.source, host: m.smtp?.host ?? null, port: m.smtp?.port ?? null, from: m.from });
});

/* ---------- email templates and branding ---------- */

const keyParam = (v: unknown): TemplateKey => {
  if (!(TEMPLATE_KEYS as readonly string[]).includes(String(v))) throw notFound('Unknown email.');
  return String(v) as TemplateKey;
};

/** Validates the text and refuses placeholders this email does not have, since they would silently come out empty. */
function checkTemplate(key: TemplateKey, body: unknown): EmailTemplate {
  const t = emailTemplateSchema.parse(body);
  const unknown = unknownPlaceholders(t, key);
  if (unknown.length) throw badRequest(`This email does not have ${unknown.map((u) => `{{${u}}}`).join(', ')}. Remove it or pick one from the list.`, 'UNKNOWN_PLACEHOLDER');
  return t;
}

settingsRouter.get('/email-templates', async (_req, res) => {
  res.json({ templates: await templateViews(), branding: await getBranding(), placeholders: PLACEHOLDERS, linkIsPublic: isPublicLink(config.webOrigin) });
});

settingsRouter.put('/email-templates/:key', async (req, res) => {
  const key = keyParam(req.params.key);
  const t = checkTemplate(key, req.body);
  const before = await getTemplate(key);
  await saveTemplate(key, t, req.auth!.user.id);
  const changed = (['subject', 'heading', 'body', 'buttonLabel', 'showDetails'] as const).filter((f) => before[f] !== t[f]);
  await audit(req, {
    action: 'settings.email_template_saved', entityType: 'settings', entityId: key,
    summary: `edited the "${TEMPLATE_META[key].label}" email (${changed.join(', ') || 'no changes'})`, before, after: t,
  });
  res.json({ templates: await templateViews() });
});

settingsRouter.delete('/email-templates/:key', async (req, res) => {
  const key = keyParam(req.params.key);
  await resetTemplate(key, req.auth!.user.id);
  await audit(req, { action: 'settings.email_template_reset', entityType: 'settings', entityId: key, summary: `reset the "${TEMPLATE_META[key].label}" email to the default` });
  res.json({ templates: await templateViews() });
});

settingsRouter.put('/email-branding', async (req, res) => {
  const b = emailBrandingSchema.parse(req.body);
  const before = await getBranding();
  await saveBranding(b, req.auth!.user.id);
  await audit(req, { action: 'settings.email_branding_saved', entityType: 'settings', entityId: 'branding', summary: 'changed the email name, footer or colour', before, after: b });
  res.json({ branding: await getBranding() });
});

/** Renders exactly what would be sent, using made-up values. Works on unsaved edits too. */
settingsRouter.post('/email-templates/:key/preview', async (req, res) => {
  const key = keyParam(req.params.key);
  const template = req.body?.template ? checkTemplate(key, req.body.template) : undefined;
  const branding = req.body?.branding ? emailBrandingSchema.parse(req.body.branding) : undefined;
  const mail = await renderEmail({ key, data: sampleFor(key), link: 'https://reimsys.example.com/receipts/123', template, branding });
  const html = mail.html.split(`cid:${LOGO_CID}`).join(`data:image/png;base64,${EMAIL_LOGO_PNG_BASE64}`);
  res.json({ ...mail, html, buttonHiddenForNow: !isPublicLink(config.webOrigin) });
});

/** Sends a sample of this email to an address so it can be checked in a real inbox. */
settingsRouter.post('/email-templates/:key/send-test', async (req, res) => {
  const key = keyParam(req.params.key);
  const to = typeof req.body?.to === 'string' && req.body.to.trim() ? req.body.to.trim() : req.auth!.user.email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw badRequest('Enter a valid email address.');
  const template = req.body?.template ? checkTemplate(key, req.body.template) : undefined;
  const mail = await renderEmail({ key, data: { ...sampleFor(key), actorName: req.auth!.user.name }, link: config.webOrigin, template });
  await queueEmail({ to, template: key, subject: `[Sample] ${mail.subject}`, html: mail.html });
  await audit(req, { action: 'email.test', entityType: 'email', summary: `sent a sample of the "${TEMPLATE_META[key].label}" email to ${to}` });
  res.status(202).json({ ok: true, to });
});
