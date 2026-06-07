import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/providers/session-provider";
import { NotificationsProvider } from "@/providers/notifications-provider";
import { GameContextProvider } from "@/providers/game-context";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { FriendsSidebar } from "@/components/friends-sidebar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Luna Negra",
  description: "Tienda de juegos web con pagos Lightning/Nostr",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-[#0a0c10] text-zinc-100">
        <SessionProvider>
          <NotificationsProvider>
            <GameContextProvider>
              <Navbar />
              {/* Reservamos espacio a la derecha para la lista de amigos fija. */}
              <main className="flex-1 xl:pr-72">{children}</main>
              <Footer />
              <FriendsSidebar />
            </GameContextProvider>
          </NotificationsProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
