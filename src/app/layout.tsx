import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "맵소사 - 소분해서 사는 맵",
  description: "동네 청과점의 제철 과일을 함께 주문하고 픽업해요.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
