import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "AI Video Studio — Script to Video Automation",
  description:
    "Professional AI-powered video generation platform. Paste a topic, select duration, and get a complete cinematic video.",
  keywords: ["AI video", "script generation", "video automation", "Groq", "ElevenLabs"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased bg-[#080c14] text-white min-h-screen`}>
        {children}
      </body>
    </html>
  );
}
