import { config } from '../config.js';
import { notify, receiptUrl } from './notify.js';

export interface PaidLine { id: number; refNo: string; payee: string; amount: number; paid: number }

const php = (n: number) => 'PHP ' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Values for the "paid" email: one line per receipt, and a note on any receipt that was paid less than its amount. */
export function paidEmailData(p: { paymentNo: string; method: string; paidOn: string; actorName: string }, lines: PaidLine[]): Record<string, string> {
  const total = lines.reduce((s, l) => s + Math.round(l.paid * 100), 0) / 100;
  return {
    paymentNo: p.paymentNo, method: p.method, paidOn: longDate(p.paidOn), actorName: p.actorName, amount: php(total),
    receiptList: lines.map((l) => `• ${l.refNo} · ${l.payee} · ${php(l.paid)}${Math.round(l.paid * 100) < Math.round(l.amount * 100) ? ` (receipt ${php(l.amount)})` : ''}`).join('\n'),
  };
}

/** One in-app notice and one email to the person who was paid, however many receipts the payment covers. */
export async function announcePaid(a: { payeeId: number; paymentNo: string; method: string; paidOn: string; actorName: string; lines: PaidLine[] }) {
  const data = paidEmailData(a, a.lines);
  const first = a.lines[0]!;
  const what = a.lines.length === 1 ? first.refNo : `${a.lines.length} receipts`;
  await notify({
    userIds: [a.payeeId], type: 'payment.paid', receiptId: first.id,
    text: `${what} paid: ${data.amount} by ${a.method} (${a.paymentNo}).`,
    email: { template: 'paid', data, link: a.lines.length === 1 ? receiptUrl(first.id) : `${config.webOrigin}/receipts` },
  });
}
