"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Banknote, Check, Printer, Ticket, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatPickupDate, orderDeadlineTimestamp } from "@/lib/pickup-dates";
import { won } from "@/lib/products";
import { LegalLinks } from "@/components/legal-links";
import { newestOrderUpdate, orderUpdatesSeenKey } from "@/lib/order-notifications";

type OrderItem = { id: string; quantity: number; confirmed_quantity: number | null; refund_quantity: number; unit_price: number; products: { name: string; specification: string; stores: { name: string; address: string } | null } | null };
type PickupPass = { token: string; issued_at: string; item_snapshot: { name: string; specification: string; quantity: number; confirmation_note?: string }[]; completed_at: string | null };
type Refund = { id: string; reason: string; amount: number; message: string; transferred_at: string | null };
type Order = { id: string; order_number: string; pickup_date: string; total: number; status: string; paid_at: string | null; created_at: string; updated_at: string; depositor_name: string; refund_bank: string; refund_account: string; refund_account_holder: string; payment_bank: string | null; payment_account: string | null; payment_account_holder: string | null; cancel_reason: string | null; cancellation_requested_at: string | null; profiles: { nickname: string } | null; order_items: OrderItem[]; pickup_passes: PickupPass[] | PickupPass | null; refunds: Refund[] };

const statusText: Record<string, string> = {
  awaiting_payment: "입금 대기", cancelled_unpaid: "취소됨", late_payment_refund: "늦은 입금 확인 중", paid_recruiting: "결제 완료 · 모집 중",
  slot_confirmed: "주문 확정 대기", store_checking: "가게 물량 확인 중", partially_refunded: "최종 내역 처리 중", refunded: "최종 내역 처리 중",
  pickup_ready: "픽업 준비 완료", picked_up: "픽업 완료", auto_completed: "자동 완료",
};
const refundText: Record<string, string> = { slot_boundary: "1세트 완료 · 다음 세트 미달", slot_unfilled: "슬롯 1세트 미달", price_limit: "가격 기준 초과", quality: "품질 기준 미충족", quantity_unavailable: "가게 수량 확보 불가", urgent_store_unreachable: "가게 연락 불가", late_payment: "늦은 입금", customer_cancelled: "고객 취소", deposit_not_confirmed: "입금 내역이 확인되지 않아 취소됐어요. 입금하셨다면 관리자에게 문의해 주세요." };
const generatedRefundMessages = new Set(["주문하신 수량을 모두 확보하기 어려워 일부 금액을 환불합니다.", "가게 확인 결과 일부 수량을 준비하기 어려워 해당 금액을 환불합니다.", "일부 품목을 준비하지 못해 주문 전체를 환불합니다."]);

export default function OrdersPage() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activePass, setActivePass] = useState<{ order: Order; pass: PickupPass } | null>(null);
  const [notice, setNotice] = useState("");
  const [currentTime, setCurrentTime] = useState(0);

  const loadOrders = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) { setLoading(false); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setSignedIn(false); setLoading(false); return; }
    setSignedIn(true);
    const { data, error } = await supabase.from("orders").select("id,order_number,pickup_date,total,status,paid_at,created_at,updated_at,depositor_name,refund_bank,refund_account,refund_account_holder,payment_bank,payment_account,payment_account_holder,cancel_reason,cancellation_requested_at,profiles(nickname),order_items(id,quantity,confirmed_quantity,refund_quantity,unit_price,products(name,specification,stores(name,address))),pickup_passes(token,issued_at,item_snapshot,completed_at),refunds(id,reason,amount,message,transferred_at)").order("created_at", { ascending: false });
    if (error) setNotice(`주문 내역을 불러오지 못했어요: ${error.message}`);
    else if (data) {
      const newest = newestOrderUpdate(data as { updated_at?: string | null }[]);
      if (newest) window.localStorage.setItem(orderUpdatesSeenKey(auth.user.id), newest);
    }
    setOrders((data ?? []) as unknown as Order[]);
    setLoading(false);
  }, []);

  useEffect(() => { void loadOrders(); }, [loadOrders]);
  useEffect(() => {
    setCurrentTime(Date.now());
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  async function cancelOrder(order: Order) {
    if (!window.confirm(order.status === "awaiting_payment" ? "입금 전 주문을 취소할까요?" : "관리자에게 취소·환불 요청을 보낼까요?")) return;
    const supabase = createClient();
    if (!supabase) return;
    const { data, error } = await supabase.rpc("cancel_my_order", { p_order_id: order.id });
    if (error) { setNotice(error.message); return; }
    setNotice(data === "cancelled" ? "주문을 취소했어요. 이 주문에는 입금하지 말아 주세요." : "취소 요청을 접수했어요. 관리자가 환불 확인 후 처리합니다.");
    await loadOrders();
  }

  async function completePickup(order: Order) {
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("complete_my_pickup", { p_order_id: order.id });
    if (error) { setNotice(error.message); return; }
    setNotice("픽업 완료로 처리했어요.");
    setActivePass(null);
    await loadOrders();
  }

  if (loading) return <main className="orders-app"><header className="orders-top"><a href="/"><ArrowLeft size={17}/>맵소사</a><b>내 주문</b></header><div className="order-empty">주문을 불러오고 있어요…</div></main>;
  return <main className="orders-app">
    <header className="orders-top"><a href="/"><ArrowLeft size={17}/>맵소사</a><b>내 주문</b><button onClick={() => void loadOrders()}>새로고침</button></header>
    <div className="orders-content"><div className="orders-heading"><span className="section-kicker">MY MAPSOSA</span><h1>주문 내역</h1><p>입금 상태와 확정 결과, 픽업 확인서를 여기서 볼 수 있어요.</p></div><div className="orders-pickup-reminder"><Ticket size={15}/><span>주문이 확정되면 주문확인서를 볼 수 있어요. 픽업하러 가실 때 청과점에 주문확인서를 보여주세요.</span></div>
      {notice && <div className="admin-notice">{notice}</div>}
      {!signedIn ? <section className="order-empty"><b>로그인이 필요해요</b><p>카카오 로그인 후 본인 주문을 확인할 수 있어요.</p><button className="admin-save" onClick={() => window.location.assign("/auth/kakao/start?next=/orders")}>카카오로 로그인</button></section> : orders.length === 0 ? <div className="order-empty">아직 주문 내역이 없어요.<a href="/">상품 보러 가기</a></div> : <div className="orders-list">{orders.map((order) => {
        const pass = Array.isArray(order.pickup_passes) ? order.pickup_passes[0] : order.pickup_passes ?? undefined;
        const isCancelled = ["cancelled_unpaid", "late_payment_refund", "refunded"].includes(order.status);
        const pendingRefund = order.refunds?.some((refund) => !refund.transferred_at) ?? false;
        const completedRefunds = order.refunds?.filter((refund) => Boolean(refund.transferred_at)) ?? [];
        const completedRefundAmount = completedRefunds.reduce((sum, refund) => sum + refund.amount, 0);
        const hasCompletedRefund = completedRefunds.length > 0;
        const cancellationClosed = currentTime >= orderDeadlineTimestamp(order.pickup_date);
        const fullyRefunded = ["refunded", "late_payment_refund"].includes(order.status) && hasCompletedRefund;
        const visibleStatus = pendingRefund && ["partially_refunded", "refunded", "late_payment_refund"].includes(order.status) ? "최종 내역 처리 중" : order.status === "refunded" && completedRefunds.length > 0 ? "환불 완료" : completedRefunds.length > 0 && pass ? "확정 · 환불 완료" : statusText[order.status] ?? order.status;
        const refundNote = completedRefunds.find((refund) => refund.message?.trim() && !generatedRefundMessages.has(refund.message.trim()))?.message;
        const confirmationNote = pass?.item_snapshot.find((item) => item.confirmation_note)?.confirmation_note ?? (!pass ? refundNote : undefined);
        const pickupStores = [...new Map(order.order_items.flatMap((item) => {
          const store = item.products?.stores;
          return store?.name ? [[`${store.name}-${store.address}`, store] as const] : [];
        })).values()];
        return <article className="order-card" key={order.id}>
          <div className="order-card-top"><div><span className="order-date">픽업 {formatPickupDate(order.pickup_date)}</span><b>{order.order_number}</b></div><span className={`order-status ${pass ? "ready" : ""}`}>{visibleStatus}</span></div>
          {pickupStores.length > 0 && <div className="order-pickup-stores"><b>픽업 가게</b>{pickupStores.map((store) => <div key={`${store.name}-${store.address}`}><strong>{store.name}</strong><span>{store.address || "가게 주소가 등록되지 않았어요."}</span></div>)}</div>}
          {confirmationNote && <div className="order-confirmation-note"><b>주문서 비고</b><span>{confirmationNote}</span></div>}
          <div className="order-items">{order.order_items.map((item) => {
            const confirmed = item.confirmed_quantity ?? (fullyRefunded ? 0 : item.quantity);
            const refunded = item.refund_quantity || (fullyRefunded ? item.quantity : 0);
            const netQuantity = Math.max(0, confirmed);
            const isRefunded = hasCompletedRefund && refunded > 0;
            return <div className={`order-line${isRefunded && netQuantity === 0 ? " refunded-order-line" : ""}`} key={item.id}><div><b>{isRefunded && netQuantity === 0 ? <s>{item.products?.name ?? "상품"}</s> : item.products?.name ?? "상품"}</b><small>{item.products?.specification} · {hasCompletedRefund ? <>{isRefunded && <><s>{item.quantity}개 주문</s> · </>}{netQuantity}개 확정{isRefunded && <> · <s>{refunded}개 환불</s></>}</> : <>{item.quantity}개 주문{item.confirmed_quantity !== null ? ` · ${item.confirmed_quantity}개 확정` : ""}</>}</small></div><span>{hasCompletedRefund ? <>{isRefunded && <s>{won(item.unit_price * item.quantity)}원</s>}<b>{won(item.unit_price * netQuantity)}원</b></> : <>{won(item.unit_price * item.quantity)}원</>}</span></div>;
          })}</div>
          <div className="order-total"><span>{hasCompletedRefund ? "최종 결제 금액" : "주문 금액"}</span><b>{hasCompletedRefund && <s>{won(order.total)}원</s>} {won(Math.max(0, order.total - completedRefundAmount))}원</b></div>
          {order.status === "awaiting_payment" && <div className="order-payment-info"><Banknote size={14}/>입금 확인 대기 · 입금자명 {order.depositor_name}<small>{order.payment_bank ? `${order.payment_bank} ${order.payment_account} · ${order.payment_account_holder}` : "입금 계좌 설정을 확인 중입니다. 관리자에게 문의해 주세요."} · 입금 여부는 관리자가 직접 확인합니다.</small></div>}
          {order.cancel_reason && <p className="order-reason">취소 사유: {refundText[order.cancel_reason] ?? order.cancel_reason}</p>}
          {order.cancellation_requested_at && <p className="order-reason">취소 요청을 확인하고 있어요. 환불 처리 결과를 이 화면에서 확인해 주세요.</p>}
          {completedRefunds.map((refund) => <div className="refund-line" key={refund.id}><b>{refundText[refund.reason] ?? "환불"} · {won(refund.amount)}원</b><span>관리자가 실제 환불 이체를 완료했어요.</span><small>이체 완료 · {new Date(refund.transferred_at!).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}</small></div>)}
          {pendingRefund && <p className="order-reason">최종 주문 내역을 정리 중이에요. 환불 금액과 결과는 관리자 확인 후 표시됩니다.</p>}
          {pass && <p className="order-ticket-reminder">픽업할 때 청과점에 주문확인서를 보여주세요.</p>}<div className="order-actions">{pass && <button className="ticket-button" onClick={() => setActivePass({ order, pass })}><Ticket size={15}/>{hasCompletedRefund ? "변경된 주문확인서 보기" : "주문확인서 보기"}</button>}{order.status === "pickup_ready" && <button className="pickup-done-button" onClick={() => void completePickup(order)}><Check size={15}/>픽업 완료</button>}{!isCancelled && order.status !== "picked_up" && order.status !== "auto_completed" && <button className="cancel-order-button" disabled={Boolean(order.cancellation_requested_at) || cancellationClosed} onClick={() => void cancelOrder(order)}>{order.cancellation_requested_at ? "취소 요청 중" : cancellationClosed ? (order.status === "awaiting_payment" ? "주문 취소 마감" : "취소·환불 마감") : order.status === "awaiting_payment" ? "주문 취소" : "취소·환불 요청"}</button>}</div>
        </article>;
      })}</div>}
      <p className="pickup-policy">픽업은 선택한 날짜에 가게에서 직접 수령해 주세요. 당일 미수령 상품은 폐기되며 환불되지 않습니다.</p>
      <LegalLinks />
    </div>
    {activePass && <div className="ticket-backdrop" onClick={() => setActivePass(null)}><section className="pickup-ticket" onClick={(event) => event.stopPropagation()}>
      <button className="ticket-close" onClick={() => setActivePass(null)} aria-label="닫기"><X size={18}/></button><span className="section-kicker">MAPSOSA PICKUP</span><h2>주문확인서</h2><b className="ticket-date">{formatPickupDate(activePass.order.pickup_date)}</b><p>픽업 날짜에 청과점에 방문해 이 주문확인서를 보여주고 상품을 픽업하세요.</p>
      <div className="ticket-profile">{activePass.order.profiles?.nickname ?? "맵소사 이웃"}<small>{activePass.order.order_number}</small></div>
      <div className="ticket-items">{(activePass.order.refunds.some((refund) => refund.transferred_at) ? activePass.order.order_items.map((item) => {
        const fullyRefunded = ["refunded", "late_payment_refund"].includes(activePass.order.status);
        const confirmed = item.confirmed_quantity ?? (fullyRefunded ? 0 : item.quantity);
        const refunded = item.refund_quantity || (fullyRefunded ? item.quantity : 0);
        return { id: item.id, name: item.products?.name ?? "상품", specification: item.products?.specification ?? "", confirmed, refunded };
      }) : activePass.pass.item_snapshot.map((item, index) => ({ id: `${item.name}-${index}`, name: item.name, specification: item.specification, confirmed: item.quantity, refunded: 0 }))).map((item) => <div className={item.refunded > 0 && item.confirmed === 0 ? "refunded-order-line" : ""} key={item.id}><span>{item.refunded > 0 && item.confirmed === 0 ? <s>{item.name}</s> : item.name} · {item.specification}{item.refunded > 0 && <small><s>{item.refunded}개 환불</s></small>}</span><b>{item.confirmed}개 확정</b></div>)}</div>
      {activePass.order.refunds.some((refund) => refund.transferred_at) && <div className="ticket-items"><div><span>환불 완료</span><b>{won(activePass.order.refunds.filter((refund) => refund.transferred_at).reduce((sum, refund) => sum + refund.amount, 0))}원</b></div><div><span>환불 계좌</span><b>{activePass.order.refund_bank} {activePass.order.refund_account}</b></div><div><span>최종 결제 금액</span><b>{won(Math.max(0, activePass.order.total - activePass.order.refunds.filter((refund) => refund.transferred_at).reduce((sum, refund) => sum + refund.amount, 0)))}원</b></div></div>}
      <div className="ticket-store-list">{[...new Map(activePass.order.order_items.map((item) => [item.products?.stores?.name, item.products?.stores?.address])).entries()].filter(([name]) => name).map(([name, address]) => <div key={name}><b>{name}</b><span>{address}</span></div>)}</div>
      {activePass.pass.item_snapshot.find((item) => item.confirmation_note)?.confirmation_note && <div className="ticket-confirmation-note"><b>주문서 비고</b><span>{activePass.pass.item_snapshot.find((item) => item.confirmation_note)?.confirmation_note}</span></div>}
      <p className="ticket-policy">당일 수령하지 않은 상품은 폐기되며 환불되지 않습니다.</p><button className="ticket-print" onClick={() => window.print()}><Printer size={15}/>주문확인서 인쇄</button>
      {activePass.order.status === "pickup_ready" && <button className="pickup-done-button ticket-done" onClick={() => void completePickup(activePass.order)}><Check size={15}/>픽업 완료 처리</button>}
    </section></div>}
  </main>;
}
