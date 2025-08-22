import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'SBP CRM',
  description: 'Basic CRM',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
