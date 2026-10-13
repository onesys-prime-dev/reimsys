// A pretend mail server for testing. It accepts email on port 1025 and saves each message,
// so you can check that REIMSIS really sends mail without needing a real account.
//
//   node e2e/smtp-catcher.mjs [folder]          start it (leave it running)
//   then start the API with:  SMTP_HOST=localhost SMTP_PORT=1025
//
// Each message is saved as <folder>/NNN.html (the email as it would look) plus NNN.json (headers).
import fs from 'node:fs';
import path from 'node:path';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';

const dir = path.resolve(process.argv[2] ?? 'storage/test-mailbox');
fs.mkdirSync(dir, { recursive: true });
let n = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length;

const server = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  // Accepts any login except the password "wrong", so sign-in failures can be tested.
  onAuth(auth, _session, cb) {
    if (auth.password === 'wrong') return cb(Object.assign(new Error('Invalid login: 535 Authentication failed'), { responseCode: 535 }));
    cb(null, { user: auth.username });
  },
  onData(stream, _session, done) {
    simpleParser(stream)
      .then((mail) => {
        n += 1;
        const id = String(n).padStart(3, '0');
        fs.writeFileSync(path.join(dir, `${id}.html`), String(mail.html || mail.textAsHtml || ''));
        const meta = { id, authUser: _session.user ?? null, from: mail.from?.text, to: mail.to?.text, subject: mail.subject, date: mail.date, text: mail.text ?? '', hasHtml: !!mail.html, messageId: mail.messageId, autoSubmitted: mail.headers.get('auto-submitted') ?? null, textPreview: (mail.text || '').slice(0, 300) };
        fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(meta, null, 2));
        console.log(`#${id}  to ${meta.to}  |  ${meta.subject}`);
        done();
      })
      .catch((e) => done(e));
  },
});

server.listen(1025, '127.0.0.1', () => console.log(`Test mailbox listening on localhost:1025, saving to ${dir}`));
