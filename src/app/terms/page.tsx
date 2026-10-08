import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { LegalLinks } from "@/components/legal-links";

export const metadata: Metadata = {
  title: "이용동의안내 | 맵소사",
  description: "맵소사 모임 참여 전 확인해 주세요.",
};

export default function TermsPage() {
  return <main className="legal-app">
    <header className="legal-header"><a href="/"><ArrowLeft size={17}/>맵소사</a><span>이용 안내</span></header>
    <article className="legal-content">
      <span className="section-kicker">PLEASE READ BEFORE JOINING</span>
      <h1>이용동의안내</h1>
      <p className="legal-lead">모임에 참여하기 전에 아래 내용을 확인해 주세요.</p>
      <section className="legal-notice">
        <h2>모임 이용 및 책임 안내</h2>
        <p>맵소사는 모임 모집 정보와 참여 현황을 제공하는 플랫폼이에요. 맵소사는 모임 참여자 간 거래·계약의 당사자가 아니며, 결제금이나 정산금을 보관·이체하지 않고, 주문·배송·수령을 대행하거나 보장하지 않아요.</p>
        <p>모임 개설자와 참여자는 입금 전에 상대방 정보, 입금 계좌, 금액, 주문·배송 조건과 정산 내역을 직접 확인해야 해요. 다른 이용자의 노쇼, 미입금, 연락두절, 허위정보 제공, 물품 미수령 등 이용자 간 행위로 생긴 분쟁과 손해는 원칙적으로 해당 이용자끼리 해결해요.</p>
        <p>맵소사는 서비스 운영·관리상 맵소사의 귀책사유에 대해서는 관계 법령에 따른 책임을 져요. 이 안내는 맵소사의 고의 또는 중대한 과실, 그 밖에 법령상 책임을 면제하는 내용이 아니에요.</p>
      </section>
      <section className="legal-notice legal-notice-soft">
        <h2>입금 전 확인해 주세요</h2>
        <ul>
          <li>모임 개설자와 참여자 정보를 직접 확인해 주세요.</li>
          <li>입금 계좌와 금액, 주문·배송 조건을 서로 확인해 주세요.</li>
          <li>정산이 필요한 경우 정산 내역과 계좌를 직접 확인해 주세요.</li>
        </ul>
      </section>
      <div className="legal-related"><a href="/privacy">개인정보처리방침 보기 <span>→</span></a></div>
    </article>
    <footer className="legal-page-footer"><LegalLinks/><small>© 2026 MAPSOSA</small></footer>
  </main>;
}
