import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { isBlank } from '@reimsys/shared';
import { api, errMsg, fmtDateTime } from '../api';
import type { CommentItem } from '../types';
import { Avatar, useToast } from '../ui';

/** A short conversation on a receipt, so a question does not need the receipt to be sent back. */
export function Comments({ receiptId }: { receiptId: number }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const key = ['comments', receiptId];
  const q = useQuery({ queryKey: key, queryFn: () => api<{ comments: CommentItem[] }>(`/receipts/${receiptId}/comments`), refetchInterval: 30_000 });
  const post = useMutation({
    mutationFn: () => api(`/receipts/${receiptId}/comments`, { method: 'POST', body: { body: text } }),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ['history', receiptId] }); },
    onError: (e) => toast(errMsg(e), 'bad'),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (!isBlank(text)) post.mutate(); };
  const items = q.data?.comments ?? [];

  return (
    <section className="card" aria-label="Comments">
      <div className="card-h"><h3>Comments</h3><small>{items.length ? `${items.length} so far` : 'Ask a question without sending it back'}</small></div>
      <div className="card-b">
        {items.map((c) => (
          <div key={c.id} className={`cmt ${c.mine ? 'mine' : ''}`}>
            <Avatar name={c.author.name} userId={c.author.id} hasPhoto={false} size={30} />
            <div><b>{c.author.name}</b> <small className="muted">{fmtDateTime(c.createdAt)}</small><p>{c.body}</p></div>
          </div>
        ))}
        {q.isSuccess && !items.length && <p className="muted" style={{ margin: '0 0 12px' }}>No comments yet.</p>}
        <form onSubmit={submit} className="cmt-form">
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment" maxLength={1000} aria-label="Write a comment" rows={2} />
          <button className="btn pri" type="submit" disabled={isBlank(text) || post.isPending}>Post</button>
        </form>
      </div>
    </section>
  );
}
