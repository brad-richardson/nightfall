import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "Nightfall",
  description: "A city-scale infrastructure sim that survives the night."
};

export default function RootLayout({
  children
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
