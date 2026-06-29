'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { IconBell } from './icons';
import CampaignChat from './CampaignChat';

interface Notif {
  id: string;
  leadId: string | null;
  leadName: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export default function Notifications() {
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState<{ leadId: string; name: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.items ?? []);
      setUnread(data.unread ?? 0);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(load, 25000);
    return () => clearInterval(iv);
  }, [load]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && unread > 0) {
      await fetch('/api/notifications/read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      setUnread(0);
      setItems((p) => p.map((n) => ({ ...n, read: true })));
    }
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        className="btn ghost sm"
        onClick={toggle}
        aria-label="Notifications"
        style={{ position: 'relative', padding: 7 }}
      >
        <IconBell width={18} height={18} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: 0, right: 0, transform: 'translate(30%,-30%)',
            background: 'var(--bad)', color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 700,
            minWidth: 16, height: 16, display: 'grid', placeItems: 'center', padding: '0 4px',
          }}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 320, maxHeight: 420, overflowY: 'auto',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)',
          boxShadow: 'var(--shadow)', zIndex: 40,
        }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 14 }}>Replies</div>
          {items.length === 0 && <p className="muted" style={{ padding: 14, fontSize: 13 }}>No replies yet.</p>}
          {items.map((n) => (
            <button
              key={n.id}
              onClick={() => { if (n.leadId) { setChat({ leadId: n.leadId, name: n.leadName }); setOpen(false); } }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                padding: '11px 14px', borderBottom: '1px solid var(--border)',
                background: n.read ? 'transparent' : 'var(--accent-soft)',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{n.leadName}</div>
              <div className="muted" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.body || 'replied'}</div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{new Date(n.createdAt).toLocaleString()}</div>
            </button>
          ))}
        </div>
      )}

      {chat && (
        <div className="modal-backdrop" onClick={() => setChat(null)}>
          <div className="modal" style={{ maxWidth: 720, padding: 0 }} onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <h2 style={{ margin: 0 }}>{chat.name}</h2>
              <button className="btn ghost sm" onClick={() => setChat(null)}>Close</button>
            </div>
            <div style={{ height: '66vh' }}>
              <CampaignChat leads={[{ leadId: chat.leadId, name: chat.name }]} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
