'use client';

import { useEffect, useState } from 'react';
import CampaignChat, { type ChatLead } from '@/app/components/CampaignChat';

export default function InboxPage() {
  const [leads, setLeads] = useState<ChatLead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [initialLeadId, setInitialLeadId] = useState<string | null>(null);

  useEffect(() => {
    // Deep-link to a specific conversation (e.g. from a reply notification).
    const p = new URLSearchParams(window.location.search);
    setInitialLeadId(p.get('lead'));
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/inbox');
      const data = await res.json();
      setLeads(data.leads ?? []);
      setLoaded(true);
    })();
  }, []);

  return (
    <div className="inbox-full">
      {!loaded ? (
        <div className="chat-empty">Loading…</div>
      ) : leads.length === 0 ? (
        <div className="chat-empty">
          No conversations yet — add leads to a campaign to start messaging them.
        </div>
      ) : (
        <CampaignChat leads={leads} initialLeadId={initialLeadId} />
      )}
    </div>
  );
}
