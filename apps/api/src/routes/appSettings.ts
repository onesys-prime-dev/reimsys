import { Router } from 'express';
import { SETTINGS_SECTIONS, appSettingsSchema, type AppSettings } from '@reimsys/shared';
import { audit } from '../lib/audit.js';
import { defaults, getSettings, resetSettings, saveSettings } from '../lib/appSettings.js';
import { requireAuth, requirePerm } from '../middleware/auth.js';

export const appSettingsRouter = Router();
appSettingsRouter.use(requireAuth);

/** Nothing secret in here, and the form needs the rules to check answers as people type, so everyone signed in may read it. */
appSettingsRouter.get('/', (_req, res) => {
  res.json({ settings: getSettings(), defaults: defaults() });
});

const labelOf = (k: keyof AppSettings) => SETTINGS_SECTIONS.flatMap((s) => s.items).find((i) => i.key === k)?.label ?? k;
const changes = (before: AppSettings, after: AppSettings) => {
  const out: { setting: string; from: unknown; to: unknown }[] = [];
  for (const k of Object.keys(after) as (keyof AppSettings)[]) if (before[k] !== after[k]) out.push({ setting: labelOf(k), from: before[k], to: after[k] });
  return out;
};

appSettingsRouter.put('/', requirePerm('settings.manage'), async (req, res) => {
  const next = appSettingsSchema.parse(req.body);
  const before = getSettings();
  const diff = changes(before, next);
  await saveSettings(next, req.auth!.user.id);
  if (diff.length) {
    await audit(req, { action: 'settings.app_saved', entityType: 'settings', entityId: 'app', summary: `changed ${diff.length} setting${diff.length === 1 ? '' : 's'}: ${diff.map((d) => d.setting).join(', ')}`, before: Object.fromEntries(diff.map((d) => [d.setting, d.from])), after: Object.fromEntries(diff.map((d) => [d.setting, d.to])) });
  }
  res.json({ settings: getSettings(), defaults: defaults() });
});

appSettingsRouter.post('/reset', requirePerm('settings.manage'), async (req, res) => {
  const before = getSettings();
  await resetSettings(req.auth!.user.id);
  await audit(req, { action: 'settings.app_reset', entityType: 'settings', entityId: 'app', summary: 'put every setting back to its default', before: Object.fromEntries(changes(before, getSettings()).map((d) => [d.setting, d.from])) });
  res.json({ settings: getSettings(), defaults: defaults() });
});
