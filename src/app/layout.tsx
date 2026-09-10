import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mock Tive Sender',
  description: 'Generate and send Tive telemetry payloads to the PAXAFE Integration API.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
