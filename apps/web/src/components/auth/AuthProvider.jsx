'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const payload = await api('/auth/me');
      setUser(payload.data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      user,
      loading,
      async login(email, password) {
        const payload = await api('/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        setUser(payload.data);
        return payload.data;
      },
      async signup(name, email, password) {
        const payload = await api('/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ name, email, password }),
        });
        setUser(payload.data);
        return payload.data;
      },
      async logout() {
        await api('/auth/logout', { method: 'POST' });
        setUser(null);
      },
      refresh,
    }),
    [user, loading, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requires AuthProvider');
  return ctx;
}
