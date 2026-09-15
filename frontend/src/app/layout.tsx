import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "@/components/layout/Sidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BRD Agent Suite",
  description: "Generate BRDs, TSDs, flowcharts, architecture diagrams, and executive one-pagers from a project description.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: some browser extensions (form-fill/security tools) stamp
    // attributes like data-island-script-injectable onto <html> before React hydrates. That's a
    // real DOM difference, but not one our code causes or can avoid — only silence it here.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`} suppressHydrationWarning>
      <body>
        <div className="app-shell">
          <Sidebar />
          <div className="app-main">{children}</div>
        </div>
      </body>
    </html>
  );
}
