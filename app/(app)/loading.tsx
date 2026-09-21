/**
 * Instant skeleton shown while an app page segment loads (e.g. the server-rendered
 * dashboard fetching its data). Keeps navigation from feeling like a hang: the
 * shell (Topbar + Nav) stays, and this placeholder appears immediately in the
 * main area until the page is ready.
 */
function Bar({ w, h = 14 }: { w: string; h?: number }) {
  return <div style={{ width: w, height: h, background: 'var(--surface-2)', borderRadius: 6 }} />;
}

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="page-header">
        <div style={{ display: 'grid', gap: 8 }}>
          <Bar w="180px" h={22} />
          <Bar w="260px" h={13} />
        </div>
      </div>
      <div className="grid cols-3" style={{ gap: 16 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="card" style={{ marginBottom: 0, display: 'grid', gap: 10 }}>
            <Bar w="60%" h={16} />
            <Bar w="90%" />
            <Bar w="75%" />
          </div>
        ))}
      </div>
    </div>
  );
}
