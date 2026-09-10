'use client';

import dynamic from 'next/dynamic';

/**
 * The console is rendered client-only.
 *
 * It is an interactive tool with no SEO value, and every piece of its initial
 * state comes from `localStorage` (endpoint, API key). Server-rendering it would
 * mean either a hydration mismatch or synchronising that state in an effect;
 * skipping SSR lets the state simply be initialised where it is read.
 */
const SenderConsole = dynamic(() => import('./SenderConsole'), {
  ssr: false,
  loading: () => <p className="hint">Loading console...</p>,
});

export default function SenderConsoleLoader() {
  return <SenderConsole />;
}
