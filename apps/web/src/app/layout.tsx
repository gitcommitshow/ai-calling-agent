/**
 * Root layout: one masthead, one content column. Loads the two Blend typefaces
 * (IBM Plex Sans for interface, Crimson Pro for headings) through next/font, so
 * they are self-hosted and need no extra dependency.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Crimson_Pro, IBM_Plex_Sans } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const interfaceFont = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});

const headingFont = Crimson_Pro({
  subsets: ['latin'],
  weight: ['300', '400'],
  variable: '--font-crimson-pro',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Calling agent',
  description: 'Set up events, guests, and call campaigns',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${interfaceFont.variable} ${headingFont.variable}`}>
      <body>
        <header className="masthead">
          <div className="masthead-inner">
            <strong>
              <Link href="/">Calling agent</Link>
            </strong>
            <Link href="/settings" className="small muted">
              Settings
            </Link>
            <span className="subtle small">
              Phase 2: outbound calling
            </span>
          </div>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
