import type { Metadata } from "next";
import { montserrat } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Allocentra AI",
  description: "AI agent that autonomously executes allocation workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body className={`antialiased font-sans`}>
        {children}
      </body>
    </html>
  );
}
