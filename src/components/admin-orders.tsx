"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleDollarSign, PackageCheck, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatPickupDate, nextPickupDate, type PickupDay } from "@/lib/pickup-dates";
import { won } from "@/lib/products";

type Line = { id: string; quantity: number; proposed_quantity: number | null; confirmed_quantity: number | null; refund_quantity: number; refund_reason: string | null; unit_price: number; products: { id: string; name: string; specification: string; type: "slot" | "instant"; slot_size: number | null; stores: { id: string; name: string } | null } | null };
type Refund = { id: string; reason: string; amount: number; message: string; transferred_at: string | null };
type Order = { id: string; order_number: string; pickup_date: string; total: number; status: string; paid_at: string | null; created_at: string; depositor_name: string; refund_bank: string; refund_account: string; refund_account_holder: string; payment_bank: string | null; payment_account: string | null; payment_account_holder: string | null; refund_preference: "all_or_nothing" | "partial"; cancellation_requested_at: string | null; profiles: { nickname: string } | null; order_items: Line[]; refunds: Refund[] };
type StoreOption = { id: string; name: string };
type Transfer = { id: string; pickup_date: string | null; type: "deposit" | "sales" | "recovery"; amount: number; transferred_at: string | null; memo: string; stores: { name: string } | null };
type ProductTotal = { id: string; type: "slot" | "instant"; slotSize: number | null; name: string; specification: string; store: string; requested: number; paid: number; unpaid: number };

const statusText: Record<string, string> = { awaiting_payment: "입금 대기", cancelled_unpaid: "미입금 취소", late_payment_refund: "늦은 입금 환불", paid_recruiting: "입금 확인 · 모집 중", slot_confirmed: "슬롯 확정", store_checking: "가게 물량 확인 중", partially_refunded: "부분 환불", refunded: "환불 완료", pickup_ready: "확정 · 확인서 발급", picked_up: "픽업 완료", auto_completed: "자동 완료" };
const activeStatuses = new Set(["awaiting_payment", "paid_recruiting", "slot_confirmed", "store_checking", "pickup_ready", "partially_refunded"]);

function upcomingDates() {
  return (["수요일", "토요일"] as PickupDay[]).map((day) => ({ day, date: nextPickupDate(day) })).sort((a, b) => a.date.localeCompare(b.date));
}

export function AdminOrders() {
  const dates = useMemo(() => upcomingDates(), []);
  const [pickupDate, setPickupDate] = useState(() => dates[0].date);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"summary" | "payment" | "refunds" | "transfers">("summary");
  const [notice, setNotice] = useState("");
  const [lineQuantities, setLineQuantities] = useState<Record<string, Record<string, number>>>({});
  const [refundReason, setRefundReason] = useState<Record<string, string>>({});
  const [availableQuantities, setAvailableQuantities] = useState<Record<string, string>>({});
  const [paymentSetting, setPaymentSetting] = useState({ bank_name: "", account_number: "", account_holder: "", memo: "주문자 이름으로 입금해 주세요." });
  const [savingPayment, setSavingPayment] = useState(false);
  const [stores, setStores] = useState<StoreOption[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [transferForm, setTransferForm] = useState({ store_id: "", type: "deposit" as Transfer["type"], amount: "", memo: "" });

  const load = useCallback(async () => {
    const supabase = createClient();
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    const [ordersResult, storesResult, transfersResult] = await Promise.all([
      supabase.from("orders").select("id,order_number,pickup_date,total,status,paid_at,created_at,depositor_name,refund_bank,refund_account,refund_account_holder,payment_bank,payment_account,payment_account_holder,refund_preference,cancellation_requested_at,profiles(nickname),order_items(id,quantity,proposed_quantity,confirmed_quantity,refund_quantity,refund_reason,unit_price,products(id,name,specification,type,slot_size,stores(id,name))),refunds(id,reason,amount,message,transferred_at)").eq("pickup_date", pickupDate).order("created_at", { ascending: true }),
      supabase.from("stores").select("id,name").order("name"),
      supabase.from("store_transfers").select("id,pickup_date,type,amount,transferred_at,memo,stores(name)").eq("pickup_date", pickupDate).order("created_at", { ascending: false }),
    ]);
    const { data, error } = ordersResult;
    if (error) setNotice(`주문을 불러오지 못했어요: ${error.message}`);
    const loaded = (data ?? []) as unknown as Order[];
    setOrders(loaded);
    const { data: storeData } = storesResult;
    const { data: transferData } = transfersResult;
    setStores((storeData ?? []) as StoreOption[]);
    setTransfers((transferData ?? []) as unknown as Transfer[]);
    if (storeData?.[0]) setTransferForm((current) => current.store_id ? current : ({ ...current, store_id: storeData[0].id }));
    setLineQuantities((previous) => {
      const next = { ...previous };
      for (const order of loaded) if (!next[order.id]) next[order.id] = Object.fromEntries(order.order_items.map((line) => [line.id, line.proposed_quantity ?? line.confirmed_quantity ?? line.quantity]));
      return next;
    });
    setLoading(false);
  }, [pickupDate]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    void supabase.from("payment_settings").select("bank_name,account_number,account_holder,memo").eq("singleton", true).maybeSingle().then(({ data }) => {
      if (data) setPaymentSetting({ bank_name: data.bank_name, account_number: data.account_number, account_holder: data.account_holder, memo: data.memo });
    });
  }, []);

  const activeOrders = orders.filter((order) => activeStatuses.has(order.status));
  const paidOrders = orders.filter((order) => Boolean(order.paid_at) || !["awaiting_payment", "cancelled_unpaid"].includes(order.status));
  const summary = new Map<string, ProductTotal>();
  for (const order of activeOrders) for (const line of order.order_items) {
    const key = `${line.products?.id ?? line.id}`;
    const item = summary.get(key) ?? { id: line.products?.id ?? key, type: line.products?.type ?? "instant", slotSize: line.products?.slot_size ?? null, name: line.products?.name ?? "상품", specification: line.products?.specification ?? "", store: line.products?.stores?.name ?? "가게 미지정", requested: 0, paid: 0, unpaid: 0 };
    item.requested += line.quantity;
    if (order.paid_at || !["awaiting_payment"].includes(order.status)) item.paid += line.quantity; else item.unpaid += line.quantity;
    summary.set(key, item);
  }
  const productTotals = [...summary.values()].sort((a, b) => a.store.localeCompare(b.store) || a.name.localeCompare(b.name));
  const paymentOrders = orders.filter((order) => order.status === "awaiting_payment" || ["paid_recruiting", "slot_confirmed", "store_checking"].includes(order.status) || Boolean(order.cancellation_requested_at) || order.refunds?.some((refund) => !refund.transferred_at));
  const refundQueue = orders.flatMap((order) => {
    const orderHasShortage = order.order_items.some((line) => {
      const confirmed = line.confirmed_quantity ?? lineQuantities[order.id]?.[line.id] ?? line.proposed_quantity ?? line.quantity;
      return confirmed < line.quantity;
    });
    const forceFullOrder = order.refund_preference === "all_or_nothing" && orderHasShortage;
    const finalized = order.order_items.some((line) => line.confirmed_quantity !== null);
    const finalRefund = order.refunds?.reduce((sum, refund) => sum + refund.amount, 0) ?? 0;
    const explicitFullRefund = ["refunded", "late_payment_refund"].includes(order.status) || Boolean(order.cancellation_requested_at);
    const lines = order.order_items.map((line) => {
      const plannedConfirmed = Math.min(line.quantity, Math.max(0, Number(lineQuantities[order.id]?.[line.id] ?? line.proposed_quantity ?? line.confirmed_quantity ?? line.quantity)));
      const refundQuantity = finalized ? line.refund_quantity : explicitFullRefund || forceFullOrder ? line.quantity : Math.max(0, line.quantity - plannedConfirmed);
      return { ...line, refundQuantity, refundAmount: refundQuantity * line.unit_price };
    }).filter((line) => line.refundQuantity > 0);
    const predictedAmount = lines.reduce((sum, line) => sum + line.refundAmount, 0);
    const amount = finalRefund || (explicitFullRefund ? order.total : predictedAmount);
    if (amount <= 0) return [];
    const isSlotPriority = lines.some((line) => line.products?.type === "slot");
    const reason = lines.find((line) => line.refund_reason)?.refund_reason ?? order.refunds?.[0]?.reason ?? (order.cancellation_requested_at ? "customer_cancelled" : "quantity_unavailable");
    return [{ order, lines, amount, reason, isSlotPriority, finalized: finalized || finalRefund > 0 }];
  }).sort((a, b) => Number(b.isSlotPriority) - Number(a.isSlotPriority) || b.order.created_at.localeCompare(a.order.created_at));
  const refundProductTotals = new Map<string, { store: string; name: string; quantity: number; amount: number }>();
  for (const entry of refundQueue) for (const line of entry.lines) {
    const key = line.products?.id ?? line.id;
    const total = refundProductTotals.get(key) ?? { store: line.products?.stores?.name ?? "가게 미지정", name: line.products?.name ?? "상품", quantity: 0, amount: 0 };
    total.quantity += line.refundQuantity; total.amount += line.refundAmount; refundProductTotals.set(key, total);
  }

  async function updateOrder(order: Order, values: Record<string, unknown>) {
    const supabase = createClient();
    if (!supabase) return false;
    const { error } = await supabase.from("orders").update(values).eq("id", order.id);
    if (error) { setNotice(error.message); return false; }
    await load();
    return true;
  }

  async function confirmDeposit(order: Order) {
    if (!window.confirm(`${order.order_number} · ${won(order.total)}원의 입금을 확인할까요?`)) return;
    const hasSlot = order.order_items.some((line) => line.products?.type === "slot");
    const nextStatus = hasSlot ? "paid_recruiting" : "store_checking";
    if (await updateOrder(order, { paid_at: new Date().toISOString(), status: nextStatus })) setNotice("입금 확인을 저장했어요.");
  }

  async function savePaymentSetting(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) return;
    setSavingPayment(true);
    const { error } = await supabase.from("payment_settings").upsert({ singleton: true, ...paymentSetting, updated_at: new Date().toISOString() }, { onConflict: "singleton" });
    setSavingPayment(false);
    setNotice(error ? error.message : "고객 입금 계좌를 저장했어요. 이후 주문부터 입금 안내에 반영됩니다.");
  }

  async function addTransfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase || !transferForm.store_id || Number(transferForm.amount) <= 0) return;
    const { error } = await supabase.from("store_transfers").insert({ round_id: null, pickup_date: pickupDate, store_id: transferForm.store_id, type: transferForm.type, amount: Number(transferForm.amount), transferred_at: new Date().toISOString(), memo: transferForm.memo.trim() });
    if (error) { setNotice(error.message); return; }
    setTransferForm((current) => ({ ...current, amount: "", memo: "" }));
    setNotice("청과점 이체 기록을 저장했어요.");
    await load();
  }

  async function finishCancellation(order: Order) {
    if (!window.confirm("고객에게 환불 이체를 완료했나요? 확인하면 환불 내역과 취소 상태가 고객 화면에 표시됩니다.")) return;
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.from("refunds").insert({ order_id: order.id, reason: "quantity_unavailable", amount: order.total, message: "고객 취소 요청에 따라 주문 금액을 전액 환불했습니다.", transferred_at: new Date().toISOString() });
    if (error) { setNotice(error.message); return; }
    if (await updateOrder(order, { status: "refunded", cancel_reason: "customer_cancelled", cancellation_requested_at: order.cancellation_requested_at })) setNotice("환불 완료로 처리했어요.");
  }

  async function markRefundTransferred(order: Order, refund: Refund) {
    if (!window.confirm(`${won(refund.amount)}원을 환불 이체 완료로 표시할까요? 실제 이체 후 처리해 주세요.`)) return;
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.from("refunds").update({ transferred_at: new Date().toISOString() }).eq("id", refund.id);
    if (error) { setNotice(error.message); return; }
    setNotice(`${order.order_number} 환불 이체 기록을 저장했어요.`);
    await load();
  }

  async function finalizeOrder(order: Order) {
    const supabase = createClient();
    if (!supabase) return;
    const confirmedItems = order.order_items.map((line) => ({ order_item_id: line.id, confirmed_quantity: Math.min(line.quantity, Math.max(0, Number(lineQuantities[order.id]?.[line.id] ?? line.quantity))) }));
    const reason = refundReason[order.id] ?? "quantity_unavailable";
    const { data, error } = await supabase.rpc("finalize_order_for_pickup", { p_order_id: order.id, p_confirmed_items: confirmedItems, p_refund_reason: reason, p_refund_message: "가게 확인 결과 일부 수량을 준비하기 어려워 해당 금액을 환불합니다." });
    if (error) { setNotice(error.message); return; }
    const result = Array.isArray(data) ? data[0] : data;
    setNotice(result?.final_status === "pickup_ready" ? "확정 주문확인서를 발급했어요. 고객의 내 주문 화면에서 확인할 수 있습니다." : "확보 가능한 수량이 없어 전액 환불 처리 대상으로 등록했어요.");
    await load();
  }

  async function calculateSlotQuantities() {
    const eligible = orders.filter((order) => order.paid_at && ["paid_recruiting", "slot_confirmed", "store_checking"].includes(order.status)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const cancelled = new Set<string>();
    let allocations = new Map<string, number>();
    let capacities = new Map<string, number>();
    for (let attempt = 0; attempt <= eligible.length; attempt += 1) {
      allocations = new Map();
      const grouped = new Map<string, { order: Order; line: Line }[]>();
      for (const order of eligible) for (const line of order.order_items) {
        const product = line.products;
        if (!product) continue;
        const group = grouped.get(product.id) ?? [];
        group.push({ order, line }); grouped.set(product.id, group);
      }
      capacities = new Map();
      for (const [productId, lines] of grouped) {
        const activeLines = lines.filter(({ order }) => !cancelled.has(order.id));
        const total = activeLines.reduce((sum, entry) => sum + entry.line.quantity, 0);
        const product = activeLines[0]?.line.products;
        const enteredCapacity = availableQuantities[productId]?.trim();
        let remaining = enteredCapacity ? Math.min(total, Math.max(0, Number(enteredCapacity))) : total;
        if (product?.type === "slot" && product.slot_size) remaining = Math.floor(remaining / product.slot_size) * product.slot_size;
        capacities.set(productId, remaining);
        for (const { order, line } of activeLines) {
          const quantity = Math.min(line.quantity, remaining);
          allocations.set(line.id, quantity);
          remaining -= quantity;
        }
      }
      const newlyCancelled = eligible.filter((order) => order.refund_preference === "all_or_nothing" && !cancelled.has(order.id) && order.order_items.some((line) => (allocations.get(line.id) ?? 0) < line.quantity));
      if (newlyCancelled.length === 0) break;
      for (const order of newlyCancelled) cancelled.add(order.id);
    }
    const nextReasons: Record<string, string> = {};
    const plannedByOrder = new Map(eligible.map((order) => [order.id, Object.fromEntries(order.order_items.map((line) => [line.id, cancelled.has(order.id) ? 0 : allocations.get(line.id) ?? line.quantity]))]));
    for (const order of eligible) {
      const shortage = order.order_items.find((line) => cancelled.has(order.id) || (allocations.get(line.id) ?? line.quantity) < line.quantity);
      if (shortage) {
        const product = shortage.products;
        const capacity = product ? capacities.get(product.id) ?? 0 : 0;
        nextReasons[order.id] = product?.type === "slot" && product.slot_size
          ? capacity < product.slot_size ? "slot_unfilled" : "slot_boundary"
          : "quantity_unavailable";
      }
    }
    setLineQuantities((current) => ({ ...current, ...Object.fromEntries(plannedByOrder) }));
    setRefundReason((current) => ({ ...current, ...nextReasons }));
    const supabase = createClient();
    if (supabase) {
      const itemUpdates = eligible.flatMap((order) => order.order_items.map((line) => supabase.from("order_items").update({ proposed_quantity: cancelled.has(order.id) ? 0 : allocations.get(line.id) ?? line.quantity }).eq("id", line.id)));
      const itemResults = await Promise.all(itemUpdates);
      const itemFailure = itemResults.find((result) => result.error);
      if (itemFailure?.error) { setNotice(itemFailure.error.message); return; }
      const updates = await Promise.all(eligible.filter((order) => order.status === "paid_recruiting").map((order) => supabase.from("orders").update({ status: "slot_confirmed" }).eq("id", order.id)));
      const failed = updates.find((result) => result.error);
      if (failed?.error) { setNotice(failed.error.message); return; }
    }
    setNotice("가게 확보 수량을 반영해 선착순 배분했어요. 슬롯은 완성 가능한 세트만 확정했고, 후순위 환불 대상은 환불 정리 탭에서 확인해 주세요.");
    setTab("refunds");
    await load();
  }

  return <div className="admin-ops">
    <form className="admin-card admin-fields" onSubmit={(event) => void savePaymentSetting(event)}><h2>고객 입금 계좌 설정</h2><div className="admin-field-pair"><div className="admin-field"><label htmlFor="payment-bank">은행</label><input id="payment-bank" value={paymentSetting.bank_name} onChange={(event) => setPaymentSetting((value) => ({ ...value, bank_name: event.target.value }))} required/></div><div className="admin-field"><label htmlFor="payment-holder">예금주</label><input id="payment-holder" value={paymentSetting.account_holder} onChange={(event) => setPaymentSetting((value) => ({ ...value, account_holder: event.target.value }))} required/></div></div><div className="admin-field"><label htmlFor="payment-account">입금 계좌번호</label><input id="payment-account" value={paymentSetting.account_number} onChange={(event) => setPaymentSetting((value) => ({ ...value, account_number: event.target.value }))} inputMode="numeric" required/></div><div className="admin-field"><label htmlFor="payment-memo">입금 안내</label><input id="payment-memo" value={paymentSetting.memo} onChange={(event) => setPaymentSetting((value) => ({ ...value, memo: event.target.value }))}/></div><button className="admin-save" disabled={savingPayment}>{savingPayment ? "저장 중…" : "입금 계좌 저장"}</button></form>
    <section className="admin-card"><div className="ops-date-title"><div><h2>픽업 주문 운영</h2><p>{formatPickupDate(pickupDate)} 기준</p></div><button className="ops-refresh" onClick={() => void load()}><RefreshCw size={14}/>새로고침</button></div>
      <div className="ops-date-picker">{dates.map(({ day, date }) => <button key={date} className={pickupDate === date ? "selected" : ""} onClick={() => setPickupDate(date)}><b>{day}</b><small>{formatPickupDate(date)}</small></button>)}</div>
      {notice && <div className="admin-notice">{notice}</div>}
      <div className="ops-tabs"><button className={tab === "summary" ? "selected" : ""} onClick={() => setTab("summary")}><PackageCheck size={14}/>주문 집계</button><button className={tab === "payment" ? "selected" : ""} onClick={() => setTab("payment")}><CircleDollarSign size={14}/>입금 확인</button><button className={tab === "refunds" ? "selected" : ""} onClick={() => setTab("refunds")}>환불 정리</button><button className={tab === "transfers" ? "selected" : ""} onClick={() => setTab("transfers")}>청과점 이체</button></div>
    </section>
    {tab === "summary" ? <>
      <div className="ops-metrics"><article><span>유효 주문</span><b>{activeOrders.length}건</b><small>{won(activeOrders.reduce((sum, order) => sum + order.total, 0))}원</small></article><article><span>입금 확인</span><b>{paidOrders.filter((order) => activeStatuses.has(order.status)).length}건</b><small>{won(paidOrders.filter((order) => activeStatuses.has(order.status)).reduce((sum, order) => sum + order.total, 0))}원</small></article><article><span>입금 대기</span><b>{orders.filter((order) => order.status === "awaiting_payment").length}건</b><small>{won(orders.filter((order) => order.status === "awaiting_payment").reduce((sum, order) => sum + order.total, 0))}원</small></article></div>
      <section className="admin-card"><div className="ops-date-title"><div><h2>가게 확보 수량 · 선착순 배분</h2><p>가게에서 확인한 실제 확보량을 입력해 주세요.</p></div></div><p className="admin-help">상품별 확보 수량을 입력하세요. 슬롯 상품은 완성된 세트만 확정하고, 부족분은 먼저 주문한 고객부터 배정합니다. 미입력 상품은 입금 확인된 주문량을 기준으로 계산해요.</p><button className="ops-action primary" style={{ marginTop: 10 }} onClick={() => void calculateSlotQuantities()}><PackageCheck size={15}/>확보 수량 반영 · 선착순 배분</button></section>
      <section className="admin-card"><h2>가게별 · 상품별 주문 총량</h2>{loading ? <div className="admin-empty">집계 중…</div> : productTotals.length ? <div className="ops-summary-list">{productTotals.map((item) => <article className="supply-summary-row" key={`${item.store}-${item.id}`}><div><b>{item.name} · {item.specification}</b><small>{item.store}{item.type === "slot" && item.slotSize ? ` · 1세트 ${item.slotSize}개` : ""}</small><span><b>요청 {item.requested}개</b><small>입금 확인 {item.paid}개 · 대기 {item.unpaid}개</small></span></div><label><small>가게 확보량</small><input type="number" min="0" inputMode="numeric" value={availableQuantities[item.id] ?? ""} onChange={(event) => setAvailableQuantities((values) => ({ ...values, [item.id]: event.target.value }))} placeholder="주문량 기준"/></label></article>)}</div> : <div className="admin-empty">이 픽업일의 주문이 없어요.</div>}</section>
    </> : tab === "payment" ? <section className="admin-card"><h2>입금 확인 작업</h2><p className="admin-help">주문별 입금 금액과 입금자명을 대조한 다음 확인 버튼을 눌러 주세요. 확인한 주문은 확정 처리 대상으로 넘어갑니다.</p>{loading ? <div className="admin-empty">주문을 불러오고 있어요…</div> : paymentOrders.length ? <div className="ops-order-list">{paymentOrders.map((order) => <article className="ops-order-card" key={order.id}>
      <div className="ops-order-head"><div><b>{order.order_number}</b><small>{order.profiles?.nickname ?? "고객"} · {order.depositor_name} · {new Date(order.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div><span className={`order-status ${order.paid_at ? "ready" : ""}`}>{statusText[order.status] ?? order.status}</span></div>
      <div className="ops-order-lines">{order.order_items.map((line) => <div key={line.id}><span>{line.products?.name ?? "상품"} · {line.quantity}개</span><small>{line.products?.stores?.name ?? "가게 미지정"}</small></div>)}</div>
      <div className="ops-payment-row"><span>입금자 <b>{order.depositor_name}</b></span><strong>{won(order.total)}원</strong></div>
      <div className="ops-transfer-instructions">입금 계좌: {order.payment_bank ? `${order.payment_bank} ${order.payment_account} · ${order.payment_account_holder}` : "계좌 설정 전 접수 주문"}</div>
      {!order.paid_at && order.status === "awaiting_payment" && <button className="ops-action primary" onClick={() => void confirmDeposit(order)}><Check size={15}/>입금 확인</button>}
      {order.cancellation_requested_at && order.status !== "refunded" && <div className="ops-cancel-request"><span>고객 취소·환불 요청</span><button className="ops-action danger" onClick={() => void finishCancellation(order)}>환불 이체 완료 처리</button></div>}
      {order.refunds?.filter((refund) => !refund.transferred_at).map((refund) => <div className="ops-cancel-request" key={refund.id}><span>환불 이체 대기 · {won(refund.amount)}원<br/>{refund.message}</span><button className="ops-action danger" onClick={() => void markRefundTransferred(order, refund)}>환불 이체 완료 처리</button></div>)}
      {(order.status === "slot_confirmed" || order.status === "store_checking") && <div className="ops-finalize"><h3>확정 수량과 환불 사유</h3>{order.order_items.map((line) => <label key={line.id}><span>{line.products?.name ?? "상품"} · 주문 {line.quantity}개</span><input type="number" min={0} max={line.quantity} value={lineQuantities[order.id]?.[line.id] ?? line.quantity} onChange={(event) => setLineQuantities((values) => ({ ...values, [order.id]: { ...values[order.id], [line.id]: Number(event.target.value) } }))}/></label>)}<select value={refundReason[order.id] ?? "quantity_unavailable"} onChange={(event) => setRefundReason((values) => ({ ...values, [order.id]: event.target.value }))}><optgroup label="슬롯 모집 결과"><option value="slot_unfilled">1세트 미달 · 모집량이 1세트를 채우지 못함</option><option value="slot_boundary">세트 잔여 · 1세트 완료 후 다음 세트 미달</option></optgroup><optgroup label="가게 사정 · 운영자 확인"><option value="quantity_unavailable">가게 수량 확보 불가</option><option value="quality">품질 기준 미충족</option><option value="price_limit">가격 기준 초과</option><option value="urgent_store_unreachable">가게 연락 불가</option></optgroup></select><small>{order.refund_preference === "all_or_nothing" ? "전체 환불 선택 주문: 한 품목이라도 부족하면 주문 전체가 환불 대상입니다." : "일부 환불 선택 주문: 선착순 배정 후 준비되지 않은 수량만 환불 대상입니다."} 환불은 실제 송금 전까지 고객 화면에 표시되지 않아요.</small><button className="ops-action primary" onClick={() => void finalizeOrder(order)}><PackageCheck size={15}/>확정 수량 저장</button></div>}
    </article>)}</div> : <div className="admin-empty">이 날짜에 입금 확인할 주문이 없어요.</div>}</section> : tab === "refunds" ? <section className="admin-card refund-manager"><h2>환불 대상과 수기 이체</h2><p className="admin-help">환불은 자동 송금되지 않아요. 슬롯 환불은 선착순 확정 결과에서 후순위 주문부터 모았고, 금액·계좌를 확인해 직접 이체한 다음 완료 처리해 주세요. 고객 화면에는 이체 완료 후에만 환불 내역이 표시돼요.</p>
      {refundProductTotals.size > 0 && <div className="refund-product-summary"><h3>가게 · 품목별 부족 수량</h3>{[...refundProductTotals.values()].sort((a,b)=>a.store.localeCompare(b.store)||a.name.localeCompare(b.name)).map((item) => <article key={`${item.store}-${item.name}`}><span><b>{item.store} · {item.name}</b><small>환불 대상 {item.quantity}개</small></span><strong>{won(item.amount)}원</strong></article>)}</div>}
      {loading ? <div className="admin-empty">환불 대상을 모으고 있어요…</div> : refundQueue.length ? <div className="ops-order-list">{refundQueue.map((entry, index) => <article className={`ops-order-card refund-queue-card${entry.isSlotPriority ? " slot-priority" : ""}`} key={entry.order.id}>
        <div className="ops-order-head"><div><b>{entry.isSlotPriority ? `슬롯 환불 우선순위 ${index + 1}` : "가게 사정 · 수기 환불"}</b><small>{entry.order.order_number} · {entry.order.profiles?.nickname ?? "고객"} · {entry.order.depositor_name}<br/>{new Date(entry.order.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 주문</small></div><span className="order-status">{entry.finalized ? "최종 금액" : "예상 금액"}</span></div>
        <div className="refund-priority-lines">{entry.lines.map((line) => <div key={line.id}><span><b>{line.products?.stores?.name ?? "가게 미지정"} · {line.products?.name ?? "상품"}</b><small>{line.refundQuantity}개 환불 × {won(line.unit_price)}원</small></span><strong>{won(line.refundAmount)}원</strong></div>)}</div>
        <div className="refund-account-details"><b>환불 유형 · {entry.amount >= entry.order.total ? "전체 환불" : "일부 환불"} <span>({entry.order.refund_preference === "all_or_nothing" ? "고객 선택: 전체 환불" : "고객 선택: 일부 환불"})</span></b><span>환불 사유 · {entry.reason === "slot_unfilled" ? "슬롯 1세트 미달" : entry.reason === "slot_boundary" ? "1세트 완료 · 다음 세트 미달" : entry.reason === "customer_cancelled" ? "고객 요청" : entry.reason === "quality" ? "품질 문제" : "가게 수량 확보 불가"}</span><span>환불 계좌 · {entry.order.refund_bank} {entry.order.refund_account} · 예금주 {entry.order.refund_account_holder}</span></div>
        {entry.order.refunds?.map((refund) => refund.transferred_at ? <div className="refund-transfer-done" key={refund.id}>이체 완료 기록 · {won(refund.amount)}원</div> : <button className="ops-action danger" key={refund.id} onClick={() => void markRefundTransferred(entry.order, refund)}>실제 이체 후 완료 처리 · {won(refund.amount)}원</button>)}
        {entry.order.cancellation_requested_at && !entry.order.refunds?.length && <button className="ops-action danger" onClick={() => void finishCancellation(entry.order)}>실제 환불 이체 후 완료 처리 · {won(entry.order.total)}원</button>}
        {!entry.finalized && <button className="ops-action primary" onClick={() => setTab("payment")}>확정 수량 저장 후 환불 확정</button>}
      </article>)}</div> : <div className="admin-empty">이 픽업일에 환불 대상이 없습니다. 수량을 정리하면 여기서 선착순 환불 대상을 확인할 수 있어요.</div>}</section> : <section className="admin-card"><h2>청과점 이체 기록</h2><p className="admin-help">예약금, 판매대금 지급, 예약금 회수 등 실제 수기 이체 후 기록해 주세요.</p><form className="admin-fields" onSubmit={(event) => void addTransfer(event)}><div className="admin-field"><label htmlFor="transfer-store">청과점</label><select id="transfer-store" value={transferForm.store_id} onChange={(event) => setTransferForm((current) => ({ ...current, store_id: event.target.value }))} required><option value="">가게 선택</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></div><div className="admin-field-pair"><div className="admin-field"><label htmlFor="transfer-type">이체 종류</label><select id="transfer-type" value={transferForm.type} onChange={(event) => setTransferForm((current) => ({ ...current, type: event.target.value as Transfer["type"] }))}><option value="deposit">예약금</option><option value="sales">판매대금</option><option value="recovery">회수</option></select></div><div className="admin-field"><label htmlFor="transfer-amount">금액</label><input id="transfer-amount" type="number" min="1" value={transferForm.amount} onChange={(event) => setTransferForm((current) => ({ ...current, amount: event.target.value }))} required/></div></div><div className="admin-field"><label htmlFor="transfer-memo">메모 (선택)</label><input id="transfer-memo" value={transferForm.memo} onChange={(event) => setTransferForm((current) => ({ ...current, memo: event.target.value }))} placeholder="예: 사과 구매 예약금"/></div><button className="admin-save" type="submit">이체 기록 저장</button></form><div className="ops-summary-list" style={{ marginTop: 15 }}>{transfers.map((transfer) => <article key={transfer.id}><div><b>{transfer.stores?.name ?? "청과점"} · {transfer.type === "deposit" ? "예약금" : transfer.type === "sales" ? "판매대금" : "회수"}</b><small>{transfer.memo || "메모 없음"} · {transfer.transferred_at ? new Date(transfer.transferred_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "이체일 미기록"}</small></div><span><b>{won(transfer.amount)}원</b></span></article>)}</div>{transfers.length === 0 && <div className="admin-empty">선택한 픽업일의 이체 기록이 없어요.</div>}</section>}
  </div>;
}
