'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** In-app confirmation dialog matching the app design (replaces window.confirm). */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className="modal-backdrop" onClick={() => close(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 8px' }}>{opts.title ?? 'Are you sure?'}</h2>
            <p className="muted" style={{ marginTop: 0 }}>{opts.message}</p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button className="btn ghost" onClick={() => close(false)}>
                {opts.cancelLabel ?? 'Cancel'}
              </button>
              <button className={`btn ${opts.danger ? 'danger' : ''}`} onClick={() => close(true)} autoFocus>
                {opts.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
