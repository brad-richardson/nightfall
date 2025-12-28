import type { ReactNode } from "react";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata = {
  title: "Nightfall",
  description: "A city-scale infrastructure sim that survives the night."
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover"
};

export default function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en" style={{
      "--font-display": "Georgia, Cambria, 'Times New Roman', Times, serif",
      "--font-sans": "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif"
    } as React.CSSProperties}>
      <body className="antialiased">
        {children}
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: 'rgba(25, 23, 16, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: '#fff',
              backdropFilter: 'blur(12px)',
            },
          }}
        />
      </body>
    </html>
  );
}
