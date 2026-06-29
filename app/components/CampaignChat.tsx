'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ChatLead {
  leadId: string;
  name: string;
  subtitle?: string;
}
interface ChatMessage {
  id: string;
  fromMe: boolean;
  text: string;
  at: string | null;
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
function dayLabel(at: string | null) {
  if (!at) return '';
  const d = new Date(at);
  const today = new Date();
  const y = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function timeLabel(at: string | null) {
  return at ? new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';
}

export default function CampaignChat({ leads }: { leads: ChatLead[] }) {
  const [active, setActive] = useState<string | null>(leads[0]?.leadId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasChat, setHasChat] = useState(true);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (leadId: string) => {
    setLoading(true);
    setErr(null);
    const res = await fetch(`/api/leads/${leadId}/conversation`);
    const data = await res.json();
    setMessages(data.messages ?? []);
    setHasChat(data.hasChat ?? false);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (active) load(active);
  }, [active, load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function send() {
    if (!active || !text.trim()) return;
    setSending(true);
    setErr(null);
    const res = await fetch(`/api/leads/${active}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text.trim() }),
    });
    const data = await res.json();
    setSending(false);
    if (!res.ok) setErr(data.error ?? `Failed (${res.status})`);
    else {
      setText('');
      load(active);
    }
  }

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return ql ? leads.filter((l) => l.name.toLowerCase().includes(ql)) : leads;
  }, [leads, q]);

  const activeLead = leads.find((l) => l.leadId === active);

  return (
    <div className="chat">
      {/* Sidebar */}
      <div className="chat-side">
        <div className="chat-side-head">
          <input placeholder="Search leads…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="chat-side-list">
          {filtered.length === 0 && <p className="muted" style={{ padding: 16, fontSize: 13 }}>No leads.</p>}
          {filtered.map((l) => (
            <button key={l.leadId} className={`chat-item ${active === l.leadId ? 'on' : ''}`} onClick={() => setActive(l.leadId)}>
              <span className="avatar-c" style={{ background: avatarColor(l.name) }}>{initials(l.name)}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: active === l.leadId ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                {l.subtitle && <span className="muted" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.subtitle}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Conversation */}
      <div className="chat-main">
        {activeLead ? (
          <>
            <div className="chat-head">
              <span className="avatar-c" style={{ width: 34, height: 34, background: avatarColor(activeLead.name) }}>{initials(activeLead.name)}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 650 }}>{activeLead.name}</span>
                {activeLead.subtitle && <span className="muted" style={{ fontSize: 12.5 }}>{activeLead.subtitle}</span>}
              </span>
            </div>

            <div className="chat-msgs">
              {loading && <div className="chat-empty">Loading…</div>}
              {!loading && messages.length === 0 && (
                <div className="chat-empty">
                  {hasChat ? 'No messages in this conversation yet.' : 'No conversation yet — send the first message below.'}
                </div>
              )}
              {!loading && messages.map((m, i) => {
                const showDate = i === 0 || dayLabel(m.at) !== dayLabel(messages[i - 1]?.at);
                return (
                  <div key={m.id}>
                    {showDate && m.at && <div className="chat-date" style={{ margin: '12px auto 8px', width: 'fit-content' }}>{dayLabel(m.at)}</div>}
                    <div className="bubble-row" style={{ justifyContent: m.fromMe ? 'flex-end' : 'flex-start' }}>
                      <div className="bubble-col" style={{ alignItems: m.fromMe ? 'flex-end' : 'flex-start' }}>
                        <div className={`bubble ${m.fromMe ? 'me' : 'them'}`}>{m.text}</div>
                        <div className="bubble-time">{timeLabel(m.at)}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            {err && <div className="notice bad" style={{ margin: '8px 16px 0' }}>{err}</div>}
            <div className="chat-compose">
              <textarea
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={`Message ${activeLead.name}…`}
                disabled={sending}
              />
              <button className="btn" onClick={send} disabled={sending || !text.trim()} style={{ borderRadius: 12 }}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        ) : (
          <div className="chat-empty">Select a lead to view the conversation.</div>
        )}
      </div>
    </div>
  );
}
