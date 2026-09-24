'use client';

import { useEffect, useState } from 'react';
import CampaignChat, { type ChatLead } from '@/app/components/CampaignChat';
import { fetchJson } from '@/lib/fetch-json';

export default function InboxPage() {
  const [leads, setLeads] = useState<ChatLead[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLeadId, setInitialLeadId] = useState<string | null>(null);

  useEffect(() => {
    // Deep-link to a specific conversation (e.g. from a reply notification).
    const p = new URLSearchParams(window.location.search);
    setInitialLeadId(p.get('lead'));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJson<{ leads?: ChatLead[] }>('/api/inbox');
        setLeads(data.leads ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load conversations.');
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  return (
    <div className="inbox-full">
      {!loaded ? (
        <div className="chat-empty">Loading…</div>
      ) : error ? (
        <div className="chat-empty">{error}</div>
      ) : leads.length === 0 ? (
        <div className="chat-empty">
          No conversations yet — message leads from the Leads page to start a conversation.
        </div>
      ) : (
        <CampaignChat leads={leads} initialLeadId={initialLeadId} />
      )}
    </div>
  );
}
