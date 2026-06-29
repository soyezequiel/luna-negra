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
import LunaNegraBackground from "@/components/LunaNegraBackground";
import { FriendsSidebar } from "@/components/friends-sidebar";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { LoginModal } from "@/components/login-modal";
import { FreshGuard } from "@/components/fresh-guard";
import { BUILD_ID } from "@/lib/build-id";
import { SITE_NAME, SITE_TAGLINE, SITE_URL } from "@/lib/site";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  weight: ["700", "800"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // `template` aplica a las páginas hijas (p. ej. la ficha pone su propio
  // título); `default` es el de la home.
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_TAGLINE,
  applicationName: SITE_NAME,
  keywords: [
    "juegos",
    "tienda de juegos",
    "Nostr",
    "Lightning",
    "Bitcoin",
    "sats",
    "zaps",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    title: SITE_NAME,
    description: SITE_TAGLINE,
    locale: "es_AR",
    // La imagen la genera app/opengraph-image.tsx (1200×630); Next la inyecta
    // automáticamente, no hace falta listarla acá.
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_TAGLINE,
  },
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
        {/* Fondo animado (pradera + luciérnagas). Canvas fijo a pantalla completa
            en z-0; todo el chrome (navbar/main/footer/aside) va en z-10+ encima. */}
        <LunaNegraBackground />
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
