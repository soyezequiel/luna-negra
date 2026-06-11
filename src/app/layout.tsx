import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/providers/session-provider";
import { NotificationsProvider } from "@/providers/notifications-provider";
import { GameContextProvider } from "@/providers/game-context";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { FriendsSidebar } from "@/components/friends-sidebar";
import { LoginModal } from "@/components/login-modal";

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
      <body className="relative flex min-h-full flex-col bg-bg text-ink">
        <SessionProvider>
          <NotificationsProvider>
            <GameContextProvider>
              <Navbar />
              {/* Reservamos espacio a la derecha para la barra de amigos/chat fija. */}
              <main className="relative z-10 flex-1 xl:pr-80">{children}</main>
              <Footer />
              <FriendsSidebar />
              <LoginModal />
            </GameContextProvider>
          </NotificationsProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
