import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { MeResponse } from '@reimsis/shared';
import { ApiError, api } from './api';

interface AuthValue {
  me: MeResponse['user'] | null;
  permissions: Set<string>;
  loading: boolean;
  can: (...codes: string[]) => boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setMe: (data: MeResponse) => void;
}

const Ctx = createContext<AuthValue>(null as never);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
    queryFn: async () => {
      try {
        return await api<MeResponse>('/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
  });

  const data = q.data ?? null;
  const permissions = useMemo(() => new Set(data?.permissions ?? []), [data]);

  useEffect(() => {
    const t = data?.user.theme ?? 'light';
    if (t === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', t);
  }, [data?.user.theme]);

  const setMe = useCallback((d: MeResponse) => qc.setQueryData(['me'], d), [qc]);

  const value: AuthValue = {
    me: data?.user ?? null,
    permissions,
    loading: q.isLoading,
    can: (...codes) => codes.every((c) => permissions.has(c)),
    setMe,
    signIn: async (email, password) => {
      const d = await api<MeResponse>('/auth/login', { method: 'POST', body: { email, password } });
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], d);
    },
    signOut: async () => {
      await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(['me'], null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
