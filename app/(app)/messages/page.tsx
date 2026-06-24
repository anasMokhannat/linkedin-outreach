'use client';

import { useCallback, useEffect, useState } from 'react';

interface LeadRef {
  first_name: string | null;
  last_name: string | null;
  profile_url: string;
  current_company: string | null;
}
interface Message {
  id: string;
  body: string;
  status: string;
  model: string | null;
  edited_by_user: boolean;
  approved_at: string | null;
  sent_at: string | null;
  leads: LeadRef | null;
}
interface Caps {
  cap: number;
  sent: number;
  remaining: number;
  reached: boolean;
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [caps, setCaps] = useState<Caps | null>(null);
  const [accountStatus, setAccountStatus] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await fetch('/api/messages');
    const data = await res.json();
    setMessages(data.messages ?? []);
    setCaps(data.caps ?? null);
    setAccountStatus(data.accountStatus ?? null);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function setMsgBusy(id: string, v: boolean) {
    setBusy((p) => ({ ...p, [id]: v }));
  }

  async function patch(id: string, action: string, body?: string) {
    setMsg(null);
    setMsgBusy(id, true);
    const res = await fetch(`/api/messages/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, body }),
    });
    const data = await res.json();
    setMsgBusy(id, false);
    if (!res.ok) setMsg(`${action} failed: ${data.error ?? res.status}`);
    else {
      setEditing((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      load();
    }
  }

  async function send(id: string) {
    setMsg(null);
    setMsgBusy(id, true);
    const res = await fetch(`/api/messages/${id}/send`, { method: 'POST' });
    const data = await res.json();
    setMsgBusy(id, false);
    if (res.status === 429) {
      setMsg('Daily limit reached — continue tomorrow.');
    } else if (!res.ok) {
      setMsg(`Send failed: ${data.error ?? res.status}`);
    } else {
      setMsg('Queued for delivery within your working hours.');
      load();
    }
  }

  function name(l: LeadRef | null) {
    if (!l) return 'Lead';
    return [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead';
  }

  const badgeClass = (s: string) =>
    s === 'sent' ? 'good' : s === 'failed' || s === 'rejected' ? 'bad' : s === 'queued' ? 'warn' : '';

  return (
    <div>
      <h1>Messages</h1>

      {caps && (
        <div className={`notice ${caps.reached ? 'warn' : ''}`} style={{ marginBottom: 14 }}>
          Today: <strong>{caps.sent}/{caps.cap}</strong> sent —{' '}
          {caps.reached ? 'daily limit reached, continue tomorrow.' : `${caps.remaining} remaining.`}
        </div>
      )}
      {accountStatus === 'needs_reauth' && (
        <div className="notice bad" style={{ marginBottom: 14 }}>
          Session expired — delivery is paused. Reconnect on the Connections page.
        </div>
      )}
      {msg && <div className="notice" style={{ marginBottom: 14 }}>{msg}</div>}

      {messages.length === 0 && <div className="card muted">No messages yet. Generate drafts from the Leads tab.</div>}

      {messages.map((m) => {
        const isEditing = m.id in editing;
        return (
          <div className="card" key={m.id}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>
                {name(m.leads)}
                {m.leads?.current_company ? <span className="muted"> · {m.leads.current_company}</span> : null}
              </strong>
              <span className={`badge ${badgeClass(m.status)}`}>{m.status}</span>
            </div>

            {isEditing ? (
              <textarea
                rows={4}
                value={editing[m.id]}
                onChange={(e) => setEditing((p) => ({ ...p, [m.id]: e.target.value }))}
                style={{ marginTop: 10 }}
              />
            ) : (
              <p style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{m.body}</p>
            )}
            <p className="muted" style={{ fontSize: 12 }}>
              {m.body.length} chars{m.model ? ` · ${m.model}` : ''}
              {m.edited_by_user ? ' · edited' : ''}
            </p>

            <div className="row" style={{ marginTop: 8 }}>
              {isEditing ? (
                <>
                  <button className="btn" onClick={() => patch(m.id, 'edit', editing[m.id])} disabled={busy[m.id]}>
                    Save
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => setEditing((p) => { const n = { ...p }; delete n[m.id]; return n; })}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  {['draft', 'approved'].includes(m.status) && (
                    <button
                      className="btn secondary"
                      onClick={() => setEditing((p) => ({ ...p, [m.id]: m.body }))}
                    >
                      Edit
                    </button>
                  )}
                  {m.status === 'draft' && (
                    <button className="btn" onClick={() => patch(m.id, 'approve')} disabled={busy[m.id]}>
                      Approve
                    </button>
                  )}
                  {['draft', 'approved'].includes(m.status) && (
                    <button className="btn ghost" onClick={() => patch(m.id, 'reject')} disabled={busy[m.id]}>
                      Reject
                    </button>
                  )}
                  {m.status === 'approved' && (
                    <button
                      className="btn"
                      onClick={() => send(m.id)}
                      disabled={busy[m.id] || caps?.reached || accountStatus === 'needs_reauth'}
                      title={caps?.reached ? 'Daily limit reached' : 'Send this one message'}
                    >
                      Send
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
