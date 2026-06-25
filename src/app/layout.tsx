import type { Metadata } from "next";
import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/providers/session-provider";
import { WalletProvider } from "@/providers/wallet-provider";
import { NotificationsProvider } from "@/providers/notifications-provider";
import { GameContextProvider } from "@/providers/game-context";
import { FriendsDrawerProvider } from "@/providers/friends-drawer";
import { FriendsProvider } from "@/providers/friends-provider";
import { NotificationsCenterProvider } from "@/providers/notifications-center-provider";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { FriendsSidebar } from "@/components/friends-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { LoginModal } from "@/components/login-modal";
import { FreshGuard } from "@/components/fresh-guard";
import { BUILD_ID } from "@/lib/build-id";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["700", "800"],
});

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
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="relative flex min-h-full flex-col font-sans text-ln-text">
        <FreshGuard version={BUILD_ID} />
        <SessionProvider>
          <WalletProvider>
          <NotificationsProvider>
            <GameContextProvider>
              <FriendsDrawerProvider>
                <FriendsProvider>
                <NotificationsCenterProvider>
                <Navbar />
                {/* Reservamos espacio a la derecha para la barra de amigos/chat
                    fija (≥880px). En móvil el aside es un drawer y dejamos un
                    spacer inferior (76px) para que la tab bar no tape contenido. */}
                <main className="relative z-10 flex-1 pb-[76px] ln:pr-[308px] ln:pb-0">
                  {children}
                </main>
                <Footer />
                <FriendsSidebar />
                <MobileTabBar />
                <LoginModal />
                </NotificationsCenterProvider>
                </FriendsProvider>
              </FriendsDrawerProvider>
            </GameContextProvider>
          </NotificationsProvider>
          </WalletProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
