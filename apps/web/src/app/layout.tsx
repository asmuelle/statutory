import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';
import './monetization.css';

export const metadata: Metadata = {
  title: 'Statutory — Living Rulebook',
  description:
    'Push-based regulatory currency for solo professionals: span-verified deltas diffed daily against primary government sources.',
};

interface RootLayoutProps {
  readonly children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
