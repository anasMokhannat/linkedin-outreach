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
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ messages?: GenMessage[] }>('/api/messages');
      const list = data.messages ?? [];
      setMessages(list);
      setEdits(Object.fromEntries(list.map((m) => [m.id, m.body])));
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Failed to load messages.', error: true });
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
      setNotice({ text: `Saved edit for ${m.name}.` });
    } catch (e) {
      setNotice({ text: `Save failed: ${e instanceof Error ? e.message : 'error'}`, error: true });
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
      setNotice({ text: `Discard failed: ${e instanceof Error ? e.message : 'error'}`, error: true });
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(m.id); return n; });
    }
  }

  // Send a draft now (uses the current edited text). Marks it sent on success.
  async function send(m: GenMessage) {
    const body = (edits[m.id] ?? m.body).trim();
    if (!body) return;
    setNotice(null);
    setSending((s) => new Set(s).add(m.id));
    try {
      await fetchJson(`/api/leads/${m.leadId}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      setMessages((list) =>
        list.map((x) => (x.id === m.id ? { ...x, status: 'sent', body, sentAt: new Date().toISOString() } : x))
      );
      setNotice({ text: `Message sent to ${m.name}.` });
    } catch (e) {
      setNotice({ text: `Send failed: ${e instanceof Error ? e.message : 'error'}`, error: true });
    } finally {
      setSending((s) => { const n = new Set(s); n.delete(m.id); return n; });
    }
  }

  // --- Bulk selection (drafts only — sent messages can't be sent/discarded) ---
  const draftMessages = messages.filter((m) => m.status !== 'sent');
  const allDraftsSelected = draftMessages.length > 0 && draftMessages.every((m) => selected.has(m.id));
  const selectedDrafts = draftMessages.filter((m) => selected.has(m.id));

  function toggleSelect(id: string) {
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleSelectAll() {
    setSelected(allDraftsSelected ? new Set() : new Set(draftMessages.map((m) => m.id)));
  }

  async function sendSelected() {
    if (!selectedDrafts.length) return;
    setBulkBusy(true);
    setNotice(null);
    let sent = 0;
    let failed = 0;
    let limitHit = false;
    for (const m of selectedDrafts) {
      const body = (edits[m.id] ?? m.body).trim();
      if (!body) continue;
      setSending((s) => new Set(s).add(m.id));
      try {
        await fetchJson(`/api/leads/${m.leadId}/send`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body }),
        });
        setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, status: 'sent', body, sentAt: new Date().toISOString() } : x)));
        setSelected((p) => { const n = new Set(p); n.delete(m.id); return n; });
        sent++;
      } catch (e) {
        failed++;
        if (/limit/i.test(e instanceof Error ? e.message : '')) { limitHit = true; setSending((s) => { const n = new Set(s); n.delete(m.id); return n; }); break; }
      } finally {
        setSending((s) => { const n = new Set(s); n.delete(m.id); return n; });
      }
    }
    setBulkBusy(false);
    setNotice({
      text: `Sent ${sent}${failed ? `, ${failed} failed` : ''}${limitHit ? ' — daily sending limit reached, continue later.' : ''}.`,
      error: sent === 0 && failed > 0,
    });
  }

  async function discardSelected() {
    if (!selectedDrafts.length) return;
    if (!(await confirm({ title: 'Discard messages', message: `Discard ${selectedDrafts.length} draft${selectedDrafts.length === 1 ? '' : 's'}?`, confirmLabel: 'Discard', danger: true }))) return;
    setBulkBusy(true);
    const deleted = new Set<string>();
    let failed = 0;
    for (const m of selectedDrafts) {
      try {
        await fetchJson(`/api/messages/${m.id}`, { method: 'DELETE' });
        deleted.add(m.id);
      } catch {
        failed++;
      }
    }
    setMessages((list) => list.filter((x) => !deleted.has(x.id)));
    setEdits((e) => { const n = { ...e }; deleted.forEach((id) => delete n[id]); return n; });
    setSelected(new Set());
    setBulkBusy(false);
    if (failed) setNotice({ text: `Discarded ${deleted.size}, ${failed} failed.`, error: deleted.size === 0 });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Generated messages</h1>
          <div className="sub">Every AI-generated message across your leads — edit drafts before they’re sent</div>
        </div>
        <div className="spacer" />
        {draftMessages.length > 0 && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn ghost sm" onClick={toggleSelectAll} disabled={bulkBusy}>
              {allDraftsSelected ? 'Deselect all' : 'Select all drafts'}
            </button>
            {selectedDrafts.length > 0 && (
              <>
                <button className="btn ghost sm" onClick={discardSelected} disabled={bulkBusy}>Discard {selectedDrafts.length}</button>
                <button className="btn sm" onClick={sendSelected} disabled={bulkBusy}>
                  {bulkBusy ? 'Sending…' : `Send ${selectedDrafts.length}`}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {notice && <div className={`notice ${notice.error ? 'bad' : ''}`}>{notice.text}</div>}

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
          const isSending = sending.has(m.id);
          return (
            <div key={m.id} className="card" style={{ marginBottom: 0 }}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                {!sent && (
                  <input
                    type="checkbox"
                    style={{ width: 'auto', marginTop: 6 }}
                    checked={selected.has(m.id)}
                    onChange={() => toggleSelect(m.id)}
                    disabled={bulkBusy}
                    aria-label={`Select message for ${m.name}`}
                  />
                )}
                <span className="avatar-c" style={{ width: 38, height: 38, fontSize: 13, background: avatarColor(m.name) }}>{initials(m.name)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 650 }}>{m.name}</div>
                  <div className="muted" style={{ fontSize: 12.5 }}>{m.subtitle ?? '—'}</div>
                </div>
                <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                  <span className={`badge ${sent ? 'good' : 'info'}`}>{sent ? 'Sent' : 'Not sent yet'}</span>
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
                      <button className="btn ghost sm" onClick={() => discard(m)} disabled={isBusy || isSaving || isSending}>
                        {isBusy ? 'Discarding…' : 'Discard'}
                      </button>
                      <button className="btn secondary sm" onClick={() => save(m)} disabled={!dirty || isSaving || isBusy || isSending}>
                        {isSaving ? 'Saving…' : 'Save edit'}
                      </button>
                      <button className="btn sm" onClick={() => send(m)} disabled={isSending || isBusy || !value.trim()}>
                        {isSending ? 'Sending…' : 'Send'}
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
