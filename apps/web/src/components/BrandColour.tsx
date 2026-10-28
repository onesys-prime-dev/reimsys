import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ACCENTS, type AccentKey, type AppSettings } from '@reimsys/shared';
import { api, errMsg } from '../api';
import { useToast } from '../ui';

/** The colour of the app for everyone who has not picked their own (Profile → Appearance). Saved with the other settings. */
export function BrandColourCard() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['app-settings'], queryFn: () => api<{ settings: AppSettings; defaults: AppSettings }>('/app-settings') });
  const save = useMutation({
    mutationFn: (k: AccentKey) => api<{ settings: AppSettings; defaults: AppSettings }>('/app-settings', { method: 'PUT', body: { ...q.data!.settings, brandAccent: k } }),
    onSuccess: (d) => { qc.setQueryData(['app-settings'], d); toast('The company colour is saved. It shows for everyone who has not chosen their own.'); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  if (!q.data || !('brandAccent' in q.data.settings)) return null;
  const cur = q.data.settings.brandAccent === 'default' ? 'teal' : q.data.settings.brandAccent;
  return (
    <section className="card" style={{ marginTop: 16 }} aria-labelledby="bc-h">
      <div className="card-h"><h3 id="bc-h">Colour of the app</h3><small>For everyone who has not picked their own in Profile → Appearance</small></div>
      <div className="card-b">
        <div className="ap-swatches" role="radiogroup" aria-label="Company colour">
          {(Object.keys(ACCENTS) as (keyof typeof ACCENTS)[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={cur === k} aria-label={ACCENTS[k].label} disabled={save.isPending} className={`ap-sw ${cur === k ? 'on' : ''}`} onClick={() => save.mutate(k)}><span style={{ ['--c' as string]: ACCENTS[k].light.accent }} />{ACCENTS[k].label}</button>
          ))}
        </div>
        <p className="muted" style={{ margin: '12px 0 0', fontSize: '.86rem' }}>This changes buttons, links and highlights on screen. Documents and emails keep their own colours (the email colour is set under Email templates).</p>
      </div>
    </section>
  );
}
