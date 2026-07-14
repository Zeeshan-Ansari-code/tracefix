'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../auth/AuthProvider.jsx';
import { TraceFixMark } from '../brand/TraceFixMark.jsx';
import styles from './AppShell.module.css';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/debug', label: 'New debug' },
  { href: '/sessions', label: 'Sessions' },
];

export function AppShell({ children }) {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const router = useRouter();
  const publicPage = pathname === '/login' || pathname === '/signup';

  if (publicPage) {
    return <div className={styles.public}>{children}</div>;
  }

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <Link href="/dashboard" className={styles.brand}>
          <TraceFixMark size={30} className={styles.mark} />
          TraceFix
        </Link>
        <p className={styles.tag}>AI debugging agent</p>
        <nav className={styles.nav}>
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname.startsWith(item.href) ? styles.navActive : styles.navLink}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className={styles.userBox}>
          <div>
            <strong>{user?.name}</strong>
            <span>{user?.email}</span>
          </div>
          <button type="button" onClick={onLogout}>
            Log out
          </button>
        </div>
      </aside>
      <div className={styles.main}>
        <div className={styles.mainInner}>{children}</div>
      </div>
    </div>
  );
}
