import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yueli DEX Playground",
  description: "Interactive playground for debugging Yueli DEX decisions and provider calls",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-dex-bg text-dex-text antialiased">
        {children}
      </body>
    </html>
  );
}
