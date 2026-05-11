import type { Metadata } from "next";
import { Inter, Sora, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ 
  subsets: ["latin"],
  variable: "--font-inter",
});

const sora = Sora({ 
  subsets: ["latin"],
  variable: "--font-sora",
  weight: ["400", "500", "600", "700"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "Mission Control - OpenClaw",
  description: "Your OpenClaw agent dashboard",
  // Intentionally not exposing a PWA manifest: Cloudflare Access intercepts
  // the manifest fetch (no cookies on cross-fetch) and redirects to its
  // login screen, which the page CSP then blocks. Mission Control is an
  // operator panel, not a PWA — dropping the manifest is the cleaner fix.
  icons: {
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        {/*
          We register /sw.js exactly so browsers that still have the old
          aggressive-caching worker pick up the self-destruct replacement.
          Once that worker activates it unregisters itself; future loads
          land with no SW at all. Safe to remove this block once we're
          sure every operator has refreshed at least once.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if("serviceWorker"in navigator)navigator.serviceWorker.register("/sw.js")`,
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${sora.variable} ${jetbrainsMono.variable} font-sans`}
        style={{ 
          backgroundColor: 'var(--background)', 
          color: 'var(--foreground)',
          fontFamily: 'var(--font-body)'
        }}
      >
        {children}
      </body>
    </html>
  );
}
