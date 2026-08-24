import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { SyncStatus } from '../domain/types';
import { getSyncStatus, startAutoSync, subscribeSyncStatus, syncNow } from '../data/sync';

type SyncContextValue = {
  status: SyncStatus;
  detail?: string;
  sync(): Promise<void>;
};

const SyncContext = createContext<SyncContextValue | null>(null);

export function SyncProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<{ status: SyncStatus; detail?: string }>({ status: getSyncStatus() });
  useEffect(() => {
    const unsubscribe = subscribeSyncStatus(setState);
    const stop = startAutoSync();
    return () => {
      unsubscribe();
      stop();
    };
  }, []);
  const value = useMemo(() => ({ ...state, sync: syncNow }), [state]);
  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside SyncProvider');
  return value;
}
