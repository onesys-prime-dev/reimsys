import { DEFAULT_SETTINGS, appSettingsSchema, type AppSettings } from '@reimsys/shared';
import { config, sessionLimits } from '../config.js';
import { prisma } from '../db.js';

const KEY = 'app';

/** What "reset to default" means: the built-in values, with the session limits the server was started with. */
export const defaults = (): AppSettings => ({
  ...DEFAULT_SETTINGS,
  sessionIdleMinutes: Math.round(config.envSessionIdleMs / 60_000),
  sessionMaxHours: Math.round(config.envSessionMaxMs / 3_600_000),
});

let current: AppSettings = defaults();

/** The settings in force right now. Cheap to call; refreshed on every save and every few seconds. */
export const getSettings = (): AppSettings => current;

function apply(s: AppSettings) {
  current = s;
  sessionLimits.idleMs = s.sessionIdleMinutes * 60_000;
  sessionLimits.maxMs = s.sessionMaxHours * 3_600_000;
}

export async function loadSettings() {
  try {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    if (!row) return apply(defaults());
    // A stored value that no longer fits the rules falls back to the default for that one setting, never to a broken form.
    const stored = JSON.parse(row.value) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...defaults() };
    for (const [k, v] of Object.entries(stored)) {
      const one = appSettingsSchema.safeParse({ ...defaults(), [k]: v });
      if (one.success) merged[k] = (one.data as Record<string, unknown>)[k];
    }
    apply(appSettingsSchema.parse(merged));
  } catch {
    /* keep what is in force */
  }
}

export async function saveSettings(s: AppSettings, userId: number) {
  const value = JSON.stringify(s);
  await prisma.setting.upsert({ where: { key: KEY }, update: { value, updatedById: userId }, create: { key: KEY, value, updatedById: userId } });
  apply(s);
}

export async function resetSettings(userId: number) {
  await prisma.setting.deleteMany({ where: { key: KEY } });
  apply(defaults());
  void userId;
}

/** Resolves once the saved settings have been read, so a job that runs at start-up does not decide with the built-in defaults. */
export const settingsReady: Promise<void> = loadSettings();
setInterval(() => void loadSettings(), 15_000).unref();
