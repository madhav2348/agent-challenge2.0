import './globals.css'

export const metadata = {
  title: 'Screenshot AI - Media Catalog',
  description: 'Universal media analysis and cataloging platform',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
