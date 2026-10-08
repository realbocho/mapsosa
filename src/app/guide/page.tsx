"use client";

import { useEffect } from "react";
import { ArrowLeft, ArrowRight, Banknote, CalendarDays, MapPin, PackageCheck, ShoppingBasket, Ticket } from "lucide-react";
import { LegalLinks } from "@/components/legal-links";

const customerSteps = [
  { icon: CalendarDays, title: "픽업 요일과 가게를 골라요" },
  { icon: ShoppingBasket, title: "상품을 담고 주문해요" },
  { icon: Banknote, title: "안내 계좌로 입금해요" },
  { icon: PackageCheck, title: "확정된 주문서를 확인해요" },
  { icon: MapPin, title: "가게에서 직접 픽업해요" },
];

export default function GuidePage() {
  useEffect(() => {
    document.title = "이용안내 | 맵소사";
    window.localStorage.setItem("mapsosa-guide-prompt-dismissed-v1", "1");
  }, []);

  return <main className="legal-app guide-app">
    <header className="legal-header"><a href="/"><ArrowLeft size={17}/>맵소사</a><span>이용안내</span></header>
    <article className="guide-content">
      <span className="section-kicker">HOW MAPSOSA WORKS</span>
      <h1>주문부터 픽업까지</h1>
      <p className="legal-lead">동네 청과점 상품을 함께 주문하고, 확정된 내역을 확인한 뒤 가게에서 직접 받아요.</p>

      <section className="guide-deadline"><CalendarDays size={18}/><div><b>주문·취소 마감</b><span>픽업일 전날 오전 10시까지 주문을 하거나 취소할 수 있어요.</span></div><small>수요일 픽업은 화요일, 토요일 픽업은 금요일</small></section>

      <section className="guide-steps" aria-label="구매자 이용 순서">
        {customerSteps.map(({ icon: Icon, title }, index) => <article className="guide-step" key={title}><span className="guide-step-number">{String(index + 1).padStart(2, "0")}</span><span className="guide-step-icon"><Icon size={17}/></span><div><h2>{title}</h2></div></article>)}
      </section>

      <section className="guide-info-card guide-info-soft">
        <div className="guide-card-title"><Ticket size={17}/><h2>주문확인서는 어디서 보나요?</h2></div>
        <p>홈 화면의 <b>내 주문</b>에서 확정 상태와 변경된 상품 수량을 확인할 수 있어요. 확정 주문서 보기 버튼으로 열고, 필요하면 인쇄할 수 있어요. 변경 사항이 생기면 홈의 내 주문 옆에 빨간 점이 표시돼요.</p>
      </section>

      <section className="guide-info-card guide-info-soft">
        <div className="guide-card-title"><PackageCheck size={17}/><h2>준비되지 못한 상품은 어떻게 되나요?</h2></div>
        <p>가게에서 준비되지 못한 상품과 환불 금액은 최종 주문확인서에 표시돼요. 환불은 관리자가 송금을 마치면 완료 내역으로 확인할 수 있어요.</p>
      </section>

      <a className="guide-home-link" href="/">가게와 상품 둘러보기 <ArrowRight size={15}/></a>
    </article>
    <footer className="legal-page-footer"><LegalLinks/><small>© 2026 MAPSOSA</small></footer>
  </main>;
}
