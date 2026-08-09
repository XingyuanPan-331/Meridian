import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";
import { ThemeProvider } from "@/contexts/ThemeContext";
import PwaRegister from "@/components/pwa-register";

export const metadata: Metadata = {
  title: "Meridian · 子午",
  description: "AI 驱动的个人时间操作系统——把脑海里的纷繁整理成可执行的时间系统，每一天围绕真正重要的事物运转。",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/meridian-icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Meridian · 子午",
  },
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "format-detection": "telephone=no",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e3a8a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
        <PwaRegister />
      </body>
    </html>
  );
}