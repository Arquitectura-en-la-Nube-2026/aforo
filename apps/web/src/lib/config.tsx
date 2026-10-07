'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { setClientApiBase } from '@/api/client';

// The image is built once and configured at runtime (ADR-0004), so the Gateway URL cannot be a
// build-time NEXT_PUBLIC_* variable. The root layout reads `API_BASE_URL` on the server per
// request and hands it to the browser through this provider.
const ConfigContext = createContext<{ apiBaseUrl: string } | null>(null);

export function ConfigProvider({
  apiBaseUrl,
  children,
}: {
  apiBaseUrl: string;
  children: ReactNode;
}) {
  // Set during render so any effect in the tree already sees it.
  setClientApiBase(apiBaseUrl);
  return <ConfigContext.Provider value={{ apiBaseUrl }}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  const value = useContext(ConfigContext);
  if (!value) throw new Error('useConfig must be used inside ConfigProvider');
  return value;
}
