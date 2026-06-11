import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DB Insurance Voice Policy Bot MVP",
  description: "Realtime voice 상담과 약관 근거 채팅 답변을 분리한 보험 상담봇 MVP"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
