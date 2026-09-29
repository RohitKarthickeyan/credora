import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: { default: 'Credora', template: '%s · Credora' },
  description: 'Credential tracking and onboarding for New York home care agencies.',
}

// Pinch-zoom is deliberately left unrestricted: the caregiver's phone form is this product's
// primary surface, and blocking scale there is an accessibility failure.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

// The root layout deliberately renders no main landmark. Each route group renders exactly one,
// with id="main", so the staff sidebar can sit outside it and the skip link has one target.
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:border focus:border-border-strong focus:bg-surface focus:px-4 focus:py-3 focus:text-field focus:font-medium focus:text-ink"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  )
}
