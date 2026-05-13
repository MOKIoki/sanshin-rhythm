import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "三線リズム稽古",
  description: "三線の工工四でリズムを学ぶアプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
