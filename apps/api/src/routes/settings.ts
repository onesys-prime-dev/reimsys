import { Router } from 'express';
import nodemailer from 'nodemailer';
import { mailSettingsSchema } from '@reimsis/shared';
import { audit } from '../lib/audit.js';
import { explainMailError } from '../lib/email.js';
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

settingsRouter.delete('/mail', async (req, res) => {
  await clearMail();
  await audit(req, { action: 'settings.mail_cleared', entityType: 'settings', entityId: 'mail', summary: 'removed the saved mail account' });
  res.json({ mail: await mailView() });
});

settingsRouter.get('/mail/status', async (_req, res) => {
  const m = await resolveMail();
  res.json({ configured: !!m.smtp, source: m.source, host: m.smtp?.host ?? null, port: m.smtp?.port ?? null, from: m.from });
});
