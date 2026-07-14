'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider.jsx';
import { TraceFixLoader } from '../ui/TraceFixLoader.jsx';

const PUBLIC = ['/login', '/signup'];

export function AuthGate({ children }) {
  const { user, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC.includes(pathname);

  useEffect(() => {
    if (loading) return;
    if (!user && !isPublic) router.replace('/login');
    if (user && isPublic) router.replace('/dashboard');
  }, [user, loading, isPublic, router]);

  if (loading) {
    return <TraceFixLoader fullScreen label="Loading TraceFix" size={64} />;
  }

  if (!user && !isPublic) return null;
  if (user && isPublic) return null;

  return children;
}
