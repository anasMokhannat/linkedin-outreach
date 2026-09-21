'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { fetchJson } from '@/lib/fetch-json';

interface GenMessage {
  id: string;
  leadId: string;
  name: string;
  subtitle?: string;
  body: string;
  status: string;
  model: string | null;
  editedByUser: boolean;
  createdAt: string;
  sentAt: string | null;
}

const AVATAR_COLORS = ['#2bb3e0', '#4361ee', '#16a34a', '#b45309', '#9333ea', '#db2777', '#0891b2', '#ca8a04'];
function avatarColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
function when(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function MessagesPage() {
  const confirm = useConfirm();
  const [messages, setMessages] = useState<GenMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ messages?: GenMessage[] }>('/api/messages');
      const list = data.messages ?? [];
      setMessages(list);
      setEdits(Object.fromEntries(list.map((m) => [m.id, m.body])));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Failed to load messages.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function save(m: GenMessage) {
    const body = (edits[m.id] ?? '').trim();
    if (!body || body === m.body) return;
    setNotice(null);
    setSaving((s) => new Set(s).add(m.id));
    try {
      await fetchJson(`/api/messages/${m.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, body, editedByUser: true } : x)));
      setNotice(`Saved edit for ${m.name}.`);
    } catch (e) {
      setNotice(`Save failed: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setSaving((s) => { const n = new Set(s); n.delete(m.id); return n; });
    }
  }

  async function discard(m: GenMessage) {
    if (!(await confirm({ title: 'Discard message', message: `Discard the generated message for ${m.name}?`, confirmLabel: 'Discard', danger: true }))) return;
    setBusy((s) => new Set(s).add(m.id));
    try {
      await fetchJson(`/api/messages/${m.id}`, { method: 'DELETE' });
      setMessages((list) => list.filter((x) => x.id !== m.id));
      setEdits((e) => { const n = { ...e }; delete n[m.id]; return n; });
    } catch (e) {
      setNotice(`Discard failed: ${e instanceof Error ? e.message : 'error'}`);
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(m.id); return n; });
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Generated messages</h1>
          <div className="sub">Every AI-generated message across your leads — edit drafts before they’re sent</div>
        </div>
        <div className="spacer" />
      </div>

      {notice && <div className="notice">{notice}</div>}

      {!loading && messages.length === 0 && (
        <div className="card muted">
          No generated messages yet. Go to <Link href="/leads">Leads</Link>, open a lead, and generate a message.
        </div>
      )}

      <div className="grid" style={{ gap: 12 }}>
        {messages.map((m) => {
          const sent = m.status === 'sent';
          const value = edits[m.id] ?? '';
          const dirty = value.trim() !== m.body && value.trim().length > 0;
          const isSaving = saving.has(m.id);
          const isBusy = busy.has(m.id);
          return (
            <div key={m.id} className="card" style={{ marginBottom: 0 }}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <span className="avatar-c" style={{ width: 38, height: 38, fontSize: 13, background: avatarColor(m.name) }}>{initials(m.name)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 650 }}>{m.name}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{m.subtitle ?? '—'}</div>
                </div>
                <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                  <span className={`badge ${sent ? 'good' : 'warn'}`}>{sent ? 'Sent' : 'Not sent yet'}</span>
                  {m.editedByUser && <span className="badge plain">edited</span>}
                  <span className="muted" style={{ fontSize: 12 }}>{when(sent ? m.sentAt : m.createdAt)}</span>
                </span>
              </div>

              {sent ? (
                <div
                  style={{ whiteSpace: 'pre-wrap', marginTop: 10, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-ctl)', fontSize: 14, lineHeight: 1.5 }}
                >
                  {m.body}
                </div>
              ) : (
                <>
                  <textarea
                    value={value}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [m.id]: e.target.value }))}
                    rows={6}
                    style={{ marginTop: 10, width: '100%', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5, resize: 'vertical' }}
                  />
                  <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                    <span className="muted" style={{ fontSize: 11.5 }}></span>
                    <span className="row" style={{ gap: 8 }}>
                      <button className="btn ghost sm" onClick={() => discard(m)} disabled={isBusy || isSaving}>
                        {isBusy ? 'Discarding…' : 'Discard'}
                      </button>
                      <button className="btn sm" onClick={() => save(m)} disabled={!dirty || isSaving || isBusy}>
                        {isSaving ? 'Saving…' : 'Save edit'}
                      </button>
                    </span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
