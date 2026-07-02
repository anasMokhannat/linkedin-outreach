'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConnectForm from '@/app/connect/ConnectForm';
import { useConfirm } from '@/app/components/ConfirmDialog';

interface Company {
  company_name?: string | null;
  company_description?: string | null;
  company_services?: string | null;
  company_usps?: string | null;
  company_pain_points?: string | null;
}
interface Offer {
  id: string;
  name: string;
  description: string | null;
}

export default function SettingsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [company, setCompany] = useState<Company>({});
  const [linkedinStatus, setLinkedinStatus] = useState<string>('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // New offer form (single field)
  const [oText, setOText] = useState('');

  async function loadOffers() {
    const res = await fetch('/api/offers');
    const data = await res.json();
    setOffers(data.offers ?? []);
  }

  async function loadSettings() {
    const res = await fetch('/api/settings');
    const data = await res.json();
    setCompany(data.user ?? {});
    setLinkedinStatus(data.linkedin?.status ?? 'disconnected');
  }

  useEffect(() => {
    loadSettings();
    loadOffers();
  }, []);

  const linkedinConnected = linkedinStatus === 'connected';

  function field<K extends keyof Company>(key: K, value: string) {
    setCompany((c) => ({ ...c, [key]: value }));
  }

  async function saveCompany() {
    setSaving(true);
    setMsg(null);
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(company),
    });
    const data = await res.json();
    setSaving(false);
    setMsg(res.ok ? 'Company context saved.' : 'Save failed: ' + (data.error ?? res.status));
  }

  async function addOffer() {
    if (!oText.trim()) return;
    const res = await fetch('/api/offers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: oText.trim() }),
    });
    const data = await res.json();
    if (!res.ok) setMsg('Failed: ' + (data.error ?? res.status));
    else { setOText(''); loadOffers(); }
  }

  async function removeOffer(id: string) {
    if (!(await confirm({ title: 'Delete offer', message: 'Delete this offer?', confirmLabel: 'Delete', danger: true }))) return;
    await fetch(`/api/offers/${id}`, { method: 'DELETE' });
    loadOffers();
  }

  async function disconnect() {
    const ok = await confirm({
      title: 'Disconnect LinkedIn',
      message: 'Disconnect your LinkedIn account from Unipile? Your app account stays signed in.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    await fetch('/api/linkedin/connect', { method: 'DELETE' });
    router.push('/connect');
    router.refresh();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <div className="sub">Company context, offers &amp; account</div>
        </div>
      </div>

      {msg && <div className="notice">{msg}</div>}

      {/* Company context */}
      <div className="card" style={{ maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}>Company context</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Used to ground AI-generated messages. The clearer this is, the more relevant your outreach.
        </p>
        <label>Company name</label>
        <input value={company.company_name ?? ''} onChange={(e) => field('company_name', e.target.value)} placeholder="Flugia" />
        <label>Description</label>
        <textarea rows={3} value={company.company_description ?? ''} onChange={(e) => field('company_description', e.target.value)} placeholder="What your company does, in a sentence or two." />
        <label>Services</label>
        <textarea rows={2} value={company.company_services ?? ''} onChange={(e) => field('company_services', e.target.value)} placeholder="The products / services you provide." />
        <label>Unique selling points</label>
        <textarea rows={2} value={company.company_usps ?? ''} onChange={(e) => field('company_usps', e.target.value)} placeholder="What sets you apart from alternatives." />
        <label>Main pain points you solve</label>
        <textarea rows={2} value={company.company_pain_points ?? ''} onChange={(e) => field('company_pain_points', e.target.value)} placeholder="The problems your customers have before they find you." />
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={saveCompany} disabled={saving}>{saving ? 'Saving…' : 'Save company context'}</button>
        </div>
      </div>

      {/* Offers */}
      <div className="card" style={{ maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}>Offers</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Reusable value-props. Pick one when creating a campaign — it grounds the generated messages.
        </p>
        {offers.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No offers yet.</p>}
        {offers.map((o) => (
          <div key={o.id} className="card" style={{ boxShadow: 'none', marginTop: 10, marginBottom: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ whiteSpace: 'pre-wrap' }}>{o.name}</span>
              <button className="btn ghost sm" onClick={() => removeOffer(o.id)}>✕</button>
            </div>
          </div>
        ))}
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <label>New offer</label>
          <textarea rows={3} value={oText} onChange={(e) => setOText(e.target.value)} placeholder="Describe what you offer and the value it delivers." />
          <div style={{ marginTop: 12 }}>
            <button className="btn secondary" onClick={addOffer} disabled={!oText.trim()}>Add offer</button>
          </div>
        </div>
      </div>

      {/* Sending limits (informational) */}
      <div className="card" style={{ maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}>Sending limits</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          To keep your LinkedIn account safe, sending is capped automatically and can&apos;t be changed.
        </p>
        <div className="row" style={{ gap: 10 }}>
          <span className="badge plain">25 messages / day</span>
          <span className="badge plain">100 messages / week</span>
        </div>
      </div>

      {/* LinkedIn account */}
      <div className="card" style={{ maxWidth: 720, borderColor: linkedinConnected ? 'var(--bad)' : 'var(--border)' }}>
        <h2 style={{ marginTop: 0 }}>LinkedIn account</h2>
        <p className="muted">
          Status: <span className={`badge ${linkedinConnected ? 'good' : 'warn'}`}>{linkedinStatus || 'disconnected'}</span>
        </p>
        {linkedinConnected ? (
          <button className="btn danger" onClick={disconnect}>Disconnect LinkedIn</button>
        ) : (
          <ConnectForm embedded onConnected={loadSettings} />
        )}
      </div>
    </div>
  );
}
