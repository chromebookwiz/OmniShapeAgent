import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShapeAgent E8",
  description: "Persistent AI Agent powered by a 256-dimensional Cl(8,0) Conformal Geometric Algebra memory lattice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
