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

interface Usage {
  allowedNow: number;
  sentToday: number;
  dailyLimit: number;
  weeklyLimit: number;
  queued: number;
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
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);

  // At the daily cap, sending is replaced by queuing (the scheduler sends later).
  const atLimit = !!usage && usage.allowedNow <= 0;

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await fetchJson<Usage>('/api/usage'));
    } catch {
      /* non-fatal — the Send/Queue toggle just falls back to Send */
    }
  }, []);

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
    loadUsage();
  }, [load, loadUsage]);

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
      loadUsage();
    } catch (e) {
      setNotice({ text: `Send failed: ${e instanceof Error ? e.message : 'error'}`, error: true });
      loadUsage();
    } finally {
      setSending((s) => { const n = new Set(s); n.delete(m.id); return n; });
    }
  }

  // Add a draft to the auto-send queue (no LinkedIn call now).
  async function queue(m: GenMessage) {
    const body = (edits[m.id] ?? m.body).trim();
    if (!body) return;
    setNotice(null);
    setBusy((s) => new Set(s).add(m.id));
    try {
      await fetchJson(`/api/leads/${m.leadId}/queue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, status: 'queued', body } : x)));
      setSelected((p) => { const n = new Set(p); n.delete(m.id); return n; });
      setNotice({ text: `Queued for ${m.name} — it will send automatically during business hours.` });
      loadUsage();
    } catch (e) {
      setNotice({ text: `Queue failed: ${e instanceof Error ? e.message : 'error'}`, error: true });
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(m.id); return n; });
    }
  }

  // Cancel a queued message → back to draft (editable again).
  async function cancelQueue(m: GenMessage) {
    setBusy((s) => new Set(s).add(m.id));
    try {
      await fetchJson(`/api/leads/${m.leadId}/queue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'unqueue' }),
      });
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, status: 'draft' } : x)));
      loadUsage();
    } catch (e) {
      setNotice({ text: `Could not cancel: ${e instanceof Error ? e.message : 'error'}`, error: true });
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(m.id); return n; });
    }
  }

  // --- Bulk selection (editable drafts only) ---
  const draftMessages = messages.filter((m) => m.status === 'draft');
  const queuedMessages = messages.filter((m) => m.status === 'queued');
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
    loadUsage();
    setNotice({
      text: `Sent ${sent}${failed ? `, ${failed} failed` : ''}${limitHit ? ' — daily limit reached, add the rest to the queue.' : ''}.`,
      error: sent === 0 && failed > 0,
    });
  }

  async function queueSelected() {
    if (!selectedDrafts.length) return;
    setBulkBusy(true);
    setNotice(null);
    let queued = 0;
    let failed = 0;
    for (const m of selectedDrafts) {
      const body = (edits[m.id] ?? m.body).trim();
      if (!body) continue;
      try {
        await fetchJson(`/api/leads/${m.leadId}/queue`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body }),
        });
        setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, status: 'queued', body } : x)));
        setSelected((p) => { const n = new Set(p); n.delete(m.id); return n; });
        queued++;
      } catch {
        failed++;
      }
    }
    setBulkBusy(false);
    loadUsage();
    setNotice({ text: `Queued ${queued}${failed ? `, ${failed} failed` : ''} — they'll send automatically during business hours.`, error: queued === 0 && failed > 0 });
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
                {atLimit ? (
                  <button className="btn sm" onClick={queueSelected} disabled={bulkBusy}>
                    {bulkBusy ? 'Queuing…' : `Add ${selectedDrafts.length} to queue`}
                  </button>
                ) : (
                  <button className="btn sm" onClick={sendSelected} disabled={bulkBusy}>
                    {bulkBusy ? 'Sending…' : `Send ${selectedDrafts.length}`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Daily-cap banner → from here new messages are queued, not sent now. */}
      {usage && (
        atLimit ? (
          <div className="notice warn">
            Daily sending limit reached ({usage.sentToday}/{usage.dailyLimit}). New messages can be <strong>added to the queue</strong> and will send automatically during business hours (Mon–Fri, 09:00–18:00).
            {usage.queued > 0 && <> You have <strong>{usage.queued}</strong> message{usage.queued === 1 ? '' : 's'} queued.</>}
          </div>
        ) : (
          <div className="notice" style={{ fontSize: 13 }}>
            {usage.allowedNow} of {usage.dailyLimit} sends left today.
            {usage.queued > 0 && <> · <strong>{usage.queued}</strong> queued for auto-send.</>}
          </div>
        )
      )}

      {notice && <div className={`notice ${notice.error ? 'bad' : ''}`}>{notice.text}</div>}

      {!loading && messages.length === 0 && (
        <div className="card muted">
          No generated messages yet. Go to <Link href="/leads">Leads</Link>, open a lead, and generate a message.
        </div>
      )}

      <div className="grid" style={{ gap: 12 }}>
        {messages.map((m) => {
          const sent = m.status === 'sent';
          const isQueued = m.status === 'queued';
          const value = edits[m.id] ?? '';
          const dirty = value.trim() !== m.body && value.trim().length > 0;
          const isSaving = saving.has(m.id);
          const isBusy = busy.has(m.id);
          const isSending = sending.has(m.id);
          return (
            <div key={m.id} className="card" style={{ marginBottom: 0 }}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                {m.status === 'draft' && (
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
                  <span className={`badge ${sent ? 'good' : isQueued ? 'progress' : 'info'}`}>
                    {sent ? 'Sent' : isQueued ? 'Queued' : 'Not sent yet'}
                  </span>
                  {m.editedByUser && <span className="badge plain">edited</span>}
                  <span className="muted" style={{ fontSize: 12 }}>{when(sent ? m.sentAt : m.createdAt)}</span>
                </span>
              </div>

              {sent || isQueued ? (
                <>
                  <div
                    style={{ whiteSpace: 'pre-wrap', marginTop: 10, padding: '12px 14px', background: 'var(--surface-2)', borderRadius: 'var(--r-ctl)', fontSize: 14, lineHeight: 1.5 }}
                  >
                    {m.body}
                  </div>
                  {isQueued && (
                    <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                      <span className="muted" style={{ fontSize: 12 }}>Waiting to send automatically during business hours.</span>
                      <button className="btn ghost sm" onClick={() => cancelQueue(m)} disabled={isBusy}>
                        {isBusy ? 'Cancelling…' : 'Cancel (back to draft)'}
                      </button>
                    </div>
                  )}
                </>
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
                        {isBusy ? 'Working…' : 'Discard'}
                      </button>
                      <button className="btn secondary sm" onClick={() => save(m)} disabled={!dirty || isSaving || isBusy || isSending}>
                        {isSaving ? 'Saving…' : 'Save edit'}
                      </button>
                      {atLimit ? (
                        <button className="btn sm" onClick={() => queue(m)} disabled={isBusy || isSaving || isSending || !value.trim()}>
                          Add to queue
                        </button>
                      ) : (
                        <button className="btn sm" onClick={() => send(m)} disabled={isSending || isBusy || !value.trim()}>
                          {isSending ? 'Sending…' : 'Send'}
                        </button>
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {queuedMessages.length > 0 && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 14 }}>
          {queuedMessages.length} message{queuedMessages.length === 1 ? '' : 's'} queued — the scheduler sends them one at a time, Mon–Fri 09:00–18:00, within the daily limit.
        </p>
      )}
    </div>
  );
}
