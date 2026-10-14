// Renders SVG files to PNG so they can be looked at: node e2e/view-svg.mjs <out-dir> <file>...
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
const [out, ...files] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
for (const f of files) {
  const svg = fs.readFileSync(f, 'utf8');
  const p = await b.newPage({ viewport: { width: 640, height: 640 } });
  await p.setContent(`<body style="margin:0;background:#e9eef0"><div style="width:640px;height:640px;display:grid;place-items:center"><img style="width:600px;height:600px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></div></body>`);
  await p.waitForTimeout(500);
  const name = path.basename(f, '.svg').replace(/\s+/g, '-');
  await p.screenshot({ path: path.join(out, name + '.png') });
  console.log('wrote', name + '.png');
}
await b.close();
