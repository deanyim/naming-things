import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { Geist, Nunito } from "next/font/google";

import { MobileBottomNav } from "~/app/_components/mobile-bottom-nav";
import { TRPCReactProvider } from "~/trpc/react";

export const metadata: Metadata = {
  title: "naming things",
  description: "compete with your friends to see who can name the most things",
  manifest: "/site.webmanifest",
  icons: [
    { rel: "icon", url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { rel: "icon", url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { rel: "apple-touch-icon", url: "/apple-touch-icon.png" },
    { rel: "shortcut icon", url: "/favicon.ico" },
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${nunito.variable}`}>
      <body>
        <TRPCReactProvider>
          {children}
          <MobileBottomNav />
        </TRPCReactProvider>
      </body>
    </html>
  );
}
