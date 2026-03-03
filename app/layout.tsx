import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const inter = Inter({ 
  subsets: ["latin", "vietnamese"],
  display: 'swap',
  variable: '--font-inter'
});

export const metadata: Metadata = {
  title: 'T07',
  description: 'Chuyển đổi văn bản nội bộ PDF sang DOCX - Học viện Kỹ thuật và Công nghệ An ninh',
  icons: {
    icon: [
      {
        url: '/images/logo-h-e1-bb-8dc-vi-e1-bb-87n-k-e1-bb-b9-thu-e1-ba-adt-v-c3-a0-c-c3-b4ng-ngh-e1-bb-87-an-ninh-n-c4-83m-2025.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/images/logo-h-e1-bb-8dc-vi-e1-bb-87n-k-e1-bb-b9-thu-e1-ba-adt-v-c3-a0-c-c3-b4ng-ngh-e1-bb-87-an-ninh-n-c4-83m-2025.png',
        media: '(prefers-color-scheme: dark)',
      },
    ],
    apple: '/images/logo-h-e1-bb-8dc-vi-e1-bb-87n-k-e1-bb-b9-thu-e1-ba-adt-v-c3-a0-c-c3-b4ng-ngh-e1-bb-87-an-ninh-n-c4-83m-2025.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`} suppressHydrationWarning>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
