"use client";

import { useEffect } from "react";
import { ArrowLeft, ArrowRight, Banknote, CalendarDays, MapPin, PackageCheck, ShoppingBasket, Store, Ticket } from "lucide-react";
import { LegalLinks } from "@/components/legal-links";

const customerSteps = [
  { icon: CalendarDays, title: "픽업 요일과 가게를 골라요", text: "수요일 또는 토요일을 선택하고, 가게를 눌러 상품과 규격·가격을 확인해요." },
  { icon: ShoppingBasket, title: "상품을 담고 주문해요", text: "원하는 수량을 장바구니에 담아요. 주문할 때 입금자명과 환불 계좌를 입력하고, 슬롯 상품은 환불 방식을 선택해요." },
  { icon: Banknote, title: "안내 계좌로 입금해요", text: "주문 화면에 표시된 금액과 계좌를 확인해 이체해 주세요. 입금 여부는 관리자가 직접 확인하며 자동 입금 판정은 하지 않아요." },
  { icon: PackageCheck, title: "확정된 주문서를 확인해요", text: "주문이 확정되면 내 주문 화면에서 최종 수량과 환불 내역이 반영된 주문확인서를 볼 수 있어요. 환불이 있으면 관리자가 실제 송금한 뒤 완료 내역이 표시돼요." },
  { icon: MapPin, title: "가게에서 직접 픽업해요", text: "주문확인서에 표시된 픽업 날짜와 가게를 확인하고 상품을 받아요. 수령을 마친 뒤 내 주문에서 픽업 완료를 눌러 주세요." },
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

      <section className="guide-deadline"><CalendarDays size={18}/><div><b>주문 마감</b><span>선택한 픽업일 전날 오전 10시</span></div><small>수요일 픽업은 화요일, 토요일 픽업은 금요일</small></section>

      <section className="guide-steps" aria-label="구매자 이용 순서">
        {customerSteps.map(({ icon: Icon, title, text }, index) => <article className="guide-step" key={title}><span className="guide-step-number">{String(index + 1).padStart(2, "0")}</span><span className="guide-step-icon"><Icon size={17}/></span><div><h2>{title}</h2><p>{text}</p></div></article>)}
      </section>

      <section className="guide-info-card">
        <div className="guide-card-title"><Store size={17}/><h2>상품 종류를 확인해 주세요</h2></div>
        <div className="guide-type-row"><b>슬롯형</b><p>정해진 수량 단위로 모아요. 슬롯 단위의 배수만큼 확정하고, 최소 한 세트를 채우지 못하거나 마지막 세트에 남는 수량은 주문 전에 고른 환불 방식에 따라 처리돼요.</p></div>
        <div className="guide-type-row"><b>즉시구매형</b><p>슬롯 모집 없이 주문할 수 있어요. 가게에서 준비 가능한 수량을 확인한 뒤 최종 수량이 확정돼요.</p></div>
      </section>

      <section className="guide-info-card guide-info-soft">
        <div className="guide-card-title"><Ticket size={17}/><h2>주문확인서는 어디서 보나요?</h2></div>
        <p>홈 화면의 <b>내 주문</b>에서 확정 상태와 변경된 상품 수량을 확인할 수 있어요. 확정 주문서 보기 버튼으로 열고, 필요하면 인쇄할 수 있어요. 변경 사항이 생기면 홈의 내 주문 옆에 빨간 점이 표시돼요.</p>
      </section>

      <details className="guide-admin-details">
        <summary><span><PackageCheck size={17}/>관리자 이용 흐름</span><span className="guide-details-arrow"><ArrowRight size={15}/></span></summary>
        <ol>
          <li><b>가게와 상품 등록</b><span>관리자 화면에서 청과점 위치·영업정보와 상품 규격·가격·종류를 등록해요.</span></li>
          <li><b>입금 확인</b><span>주문별 입금자와 금액을 대조하고 직접 입금 확인을 처리해요.</span></li>
          <li><b>슬롯·가게 수량 확인</b><span>픽업 전날 오전 11시부터 슬롯을 확정하고, 확정된 주문을 기준으로 가게 준비 수량과 최종 수량을 정리해요.</span></li>
          <li><b>환불 및 주문서 반영</b><span>환불액을 직접 이체한 뒤 완료 처리하면 고객 주문서에 최종 수량과 환불 내역이 반영돼요.</span></li>
        </ol>
        <a href="/admin">관리자 화면 열기 <ArrowRight size={14}/></a>
      </details>

      <a className="guide-home-link" href="/">가게와 상품 둘러보기 <ArrowRight size={15}/></a>
    </article>
    <footer className="legal-page-footer"><LegalLinks/><small>© 2026 MAPSOSA</small></footer>
  </main>;
}
