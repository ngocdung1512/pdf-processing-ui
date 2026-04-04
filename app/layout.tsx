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
  title: 'Học viện Kỹ thuật và Công nghệ An ninh',
  description: 'Chuyển đổi văn bản nội bộ PDF sang DOCX - Học viện Kỹ thuật và Công nghệ An ninh',
  icons: {
    icon: [
      { url: '/branding/logo.png', media: '(prefers-color-scheme: light)' },
      { url: '/branding/logo.png', media: '(prefers-color-scheme: dark)' },
    ],
    apple: '/branding/logo.png',
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
