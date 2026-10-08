import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "맵소사 — 동네 과일, 더 좋은 가격으로",
  description: "동네 청과점의 제철 과일을 함께 주문하고 픽업해요.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
