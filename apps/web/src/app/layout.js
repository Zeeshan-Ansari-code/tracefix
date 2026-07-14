import { Sora, Figtree, JetBrains_Mono } from 'next/font/google';
import { AuthProvider } from '../components/auth/AuthProvider.jsx';
import { AuthGate } from '../components/auth/AuthGate.jsx';
import { AppShell } from '../components/layout/AppShell.jsx';
import './globals.css';

const sora = Sora({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700', '800'],
});

const figtree = Figtree({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['400', '500', '600', '700'],
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
});

export const metadata = {
  title: 'TraceFix — AI Debugging Agent',
  description:
    'Agent dashboard for running apps, reading console and network, finding root causes, applying fixes, and confirming resolution.',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sora.variable} ${figtree.variable} ${jetbrains.variable}`}>
      <body>
        <AuthProvider>
          <AuthGate>
            <AppShell>{children}</AppShell>
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
