import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";

// Display face — used sparingly for KPI figures and section headers, giving
// the pharmacy-ledger identity its warmth (see docs/design-system.md).
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Body/UI face — clinical, highly legible for dense data tables and forms.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

// Utility face — every reference code in the system (SKU, batch, invoice,
// journal entry, transfer, Rx numbers) shares this same disciplined
// monospace treatment. See the "code chip" styling used throughout.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Bizness Shop-OS - Pharmacy Management System",
  description: "Modern pharmacy management system for inventory, sales, prescriptions, and more.",
  icons: {
    icon: "/brand/logo-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable} antialiased bg-background text-foreground`}
      >
        <Providers>{children}</Providers>
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
