"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Check, Clock3, Printer, Ticket, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { createClient } from "@/lib/supabase/client";
import { formatPickupDate } from "@/lib/pickup-dates";
import { won } from "@/lib/products";
import { LegalLinks } from "@/components/legal-links";

type OrderItem = { id: string; quantity: number; confirmed_quantity: number | null; refund_quantity: number; unit_price: number; products: { name: string; specification: string; stores: { name: string; address: string } | null } | null };
type PickupPass = { token: string; issued_at: string; item_snapshot: { name: string; specification: string; quantity: number }[]; completed_at: string | null };
type Refund = { id: string; reason: string; amount: number; message: string; transferred_at: string | null };
type Order = { id: string; order_number: string; pickup_date: string; total: number; status: string; payment_due_at: string; paid_at: string | null; created_at: string; depositor_name: string; refund_bank: string; refund_account: string; refund_account_holder: string; payment_bank: string | null; payment_account: string | null; payment_account_holder: string | null; cancel_reason: string | null; cancellation_requested_at: string | null; profiles: { nickname: string } | null; order_items: OrderItem[]; pickup_passes: PickupPass[] | PickupPass | null; refunds: Refund[] };

const statusText: Record<string, string> = {
  awaiting_payment: "입금 대기", cancelled_unpaid: "취소됨", late_payment_refund: "늦은 입금 환불 대기", paid_recruiting: "결제 완료 · 모집 중",
  slot_confirmed: "주문 확정 대기", store_checking: "가게 물량 확인 중", partially_refunded: "일부 환불 처리 중", refunded: "환불 완료",
  pickup_ready: "픽업 준비 완료", picked_up: "픽업 완료", auto_completed: "자동 완료",
};
const refundText: Record<string, string> = { slot_boundary: "슬롯 잔여 수량", slot_unfilled: "슬롯 미충족", price_limit: "가격 기준 초과", quality: "품질 기준 미충족", quantity_unavailable: "수량 확보 불가", urgent_store_unreachable: "가게 연락 불가", late_payment: "늦은 입금", customer_cancelled: "고객 취소" };

export default function OrdersPage() {
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activePass, setActivePass] = useState<{ order: Order; pass: PickupPass } | null>(null);
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState("");

  const loadOrders = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) { setLoading(false); return; }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) { setSignedIn(false); setLoading(false); return; }
    setSignedIn(true);
    const { data, error } = await supabase.from("orders").select("id,order_number,pickup_date,total,status,payment_due_at,paid_at,created_at,depositor_name,refund_bank,refund_account,refund_account_holder,payment_bank,payment_account,payment_account_holder,cancel_reason,cancellation_requested_at,profiles(nickname),order_items(id,quantity,confirmed_quantity,refund_quantity,unit_price,products(name,specification,stores(name,address))),pickup_passes(token,issued_at,item_snapshot,completed_at),refunds(id,reason,amount,message,transferred_at)").order("created_at", { ascending: false });
    if (error) setNotice(`주문 내역을 불러오지 못했어요: ${error.message}`);
    setOrders((data ?? []) as unknown as Order[]);
    setLoading(false);
  }, []);

  useEffect(() => { void loadOrders(); }, [loadOrders]);
  useEffect(() => { setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);

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
    <div className="orders-content"><div className="orders-heading"><span className="section-kicker">MY MAPSOSA</span><h1>주문 내역</h1><p>입금 상태와 확정 결과, 픽업 확인서를 여기서 볼 수 있어요.</p></div>
      {notice && <div className="admin-notice">{notice}</div>}
      {!signedIn ? <section className="order-empty"><b>로그인이 필요해요</b><p>카카오 로그인 후 본인 주문을 확인할 수 있어요.</p><button className="admin-save" onClick={() => window.location.assign("/auth/kakao/start?next=/orders")}>카카오로 로그인</button></section> : orders.length === 0 ? <div className="order-empty">아직 주문 내역이 없어요.<a href="/">상품 보러 가기</a></div> : <div className="orders-list">{orders.map((order) => {
        const pass = Array.isArray(order.pickup_passes) ? order.pickup_passes[0] : order.pickup_passes ?? undefined;
        const remaining = Math.max(0, Math.ceil((new Date(order.payment_due_at).getTime() - now) / 60000));
        const isCancelled = ["cancelled_unpaid", "late_payment_refund", "refunded"].includes(order.status);
        return <article className="order-card" key={order.id}>
          <div className="order-card-top"><div><span className="order-date">픽업 {formatPickupDate(order.pickup_date)}</span><b>{order.order_number}</b></div><span className={`order-status ${pass ? "ready" : ""}`}>{statusText[order.status] ?? order.status}</span></div>
          <div className="order-items">{order.order_items.map((item) => {
            const confirmed = item.confirmed_quantity;
            return <div className="order-line" key={item.id}><div><b>{item.products?.name ?? "상품"}</b><small>{item.products?.specification} · {item.quantity}개 주문{confirmed !== null ? ` · ${confirmed}개 확정` : ""}</small></div><span>{won(item.unit_price * item.quantity)}원</span></div>;
          })}</div>
          <div className="order-total"><span>주문 금액</span><b>{won(order.total)}원</b></div>
          {order.status === "awaiting_payment" && <div className="order-payment-info"><Clock3 size={14}/>입금 기한까지 약 {remaining}분 · 입금자명 {order.depositor_name}<small>{order.payment_bank ? `${order.payment_bank} ${order.payment_account} · ${order.payment_account_holder}` : "입금 계좌 설정을 확인 중입니다. 관리자에게 문의해 주세요."} · 주문 후 1시간 이내 입금해 주세요.</small></div>}
          {order.cancel_reason && <p className="order-reason">취소 사유: {refundText[order.cancel_reason] ?? order.cancel_reason}</p>}
          {order.cancellation_requested_at && <p className="order-reason">취소 요청을 확인하고 있어요. 환불 처리 결과를 이 화면에서 확인해 주세요.</p>}
          {order.refunds?.map((refund) => <div className="refund-line" key={refund.id}><b>{refundText[refund.reason] ?? "환불"} · {won(refund.amount)}원</b><span>{refund.message}</span><small>{refund.transferred_at ? "환불 이체 완료" : "환불 이체 확인 중"}</small></div>)}
          <div className="order-actions">{pass && <button className="ticket-button" onClick={() => setActivePass({ order, pass })}><Ticket size={15}/>주문확인서 보기</button>}{order.status === "pickup_ready" && <button className="pickup-done-button" onClick={() => void completePickup(order)}><Check size={15}/>픽업 완료</button>}{!isCancelled && order.status !== "picked_up" && order.status !== "auto_completed" && <button className="cancel-order-button" disabled={Boolean(order.cancellation_requested_at)} onClick={() => void cancelOrder(order)}>{order.status === "awaiting_payment" ? "주문 취소" : order.cancellation_requested_at ? "취소 요청 중" : "취소·환불 요청"}</button>}</div>
        </article>;
      })}</div>}
      <p className="pickup-policy">픽업은 선택한 날짜에 가게에서 직접 수령해 주세요. 당일 미수령 상품은 폐기되며 환불되지 않습니다.</p>
      <LegalLinks />
    </div>
    {activePass && <div className="ticket-backdrop" onClick={() => setActivePass(null)}><section className="pickup-ticket" onClick={(event) => event.stopPropagation()}>
      <button className="ticket-close" onClick={() => setActivePass(null)} aria-label="닫기"><X size={18}/></button><span className="section-kicker">MAPSOSA PICKUP</span><h2>주문확인서</h2><b className="ticket-date">{formatPickupDate(activePass.order.pickup_date)}</b><p>픽업 날짜 당일 수령이 원칙입니다</p>
      <div className="ticket-profile">{activePass.order.profiles?.nickname ?? "맵소사 이웃"}<small>{activePass.order.order_number}</small></div>
      <div className="ticket-items">{activePass.pass.item_snapshot.map((item, index) => <div key={`${item.name}-${index}`}><span>{item.name} · {item.specification}</span><b>{item.quantity}개</b></div>)}</div>
      <div className="ticket-qr"><QRCodeSVG value={activePass.order.order_number} size={144} includeMargin/><small>주문번호 확인용</small></div>
      <div className="ticket-store-list">{[...new Map(activePass.order.order_items.map((item) => [item.products?.stores?.name, item.products?.stores?.address])).entries()].filter(([name]) => name).map(([name, address]) => <div key={name}><b>{name}</b><span>{address}</span></div>)}</div>
      <p className="ticket-policy">당일 수령하지 않은 상품은 폐기되며 환불되지 않습니다.</p><button className="ticket-print" onClick={() => window.print()}><Printer size={15}/>주문확인서 인쇄</button>
      {activePass.order.status === "pickup_ready" && <button className="pickup-done-button ticket-done" onClick={() => void completePickup(activePass.order)}><Check size={15}/>픽업 완료 처리</button>}
    </section></div>}
  </main>;
}
