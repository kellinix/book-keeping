import "../styles/globals.css";
import ClientLayout from "../components/ClientLayout";

export const metadata = {
  title: "VoiceLedger",
  description: "AI-powered bookkeeping for UK small businesses",
  icons: { apple: "/logo.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      </head>
      <body>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  );
}
