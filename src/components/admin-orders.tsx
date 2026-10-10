"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleDollarSign, PackageCheck, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatPickupDate, nextPickupDate, type PickupDay } from "@/lib/pickup-dates";
import { won } from "@/lib/products";

type Line = { id: string; quantity: number; proposed_quantity: number | null; confirmed_quantity: number | null; refund_quantity: number; refund_reason: string | null; unit_price: number; products: { id: string; name: string; specification: string; type: "slot" | "instant"; slot_size: number | null; stores: { id: string; name: string } | null } | null };
type Refund = { id: string; reason: string; amount: number; message: string; transferred_at: string | null };
type Order = { id: string; order_number: string; pickup_date: string; total: number; status: string; paid_at: string | null; inventory_reviewed_at: string | null; created_at: string; depositor_name: string; refund_bank: string; refund_account: string; refund_account_holder: string; payment_bank: string | null; payment_account: string | null; payment_account_holder: string | null; refund_preference: "all_or_nothing" | "partial"; cancellation_requested_at: string | null; profiles: { nickname: string } | null; order_items: Line[]; refunds: Refund[] };
type StoreOption = { id: string; name: string };
type Transfer = { id: string; pickup_date: string | null; type: "deposit" | "sales" | "recovery"; amount: number; transferred_at: string | null; memo: string; stores: { name: string } | null };
type ProductTotal = { id: string; type: "slot" | "instant"; slotSize: number | null; name: string; specification: string; storeId: string; store: string; requested: number; paid: number; unpaid: number; confirmed: number; amount: number; amountReady: boolean; slotCalculated: boolean };

const statusText: Record<string, string> = { awaiting_payment: "입금 대기", cancelled_unpaid: "미입금 취소", late_payment_refund: "늦은 입금 환불", paid_recruiting: "입금 확인 · 모집 중", slot_confirmed: "슬롯 확정", store_checking: "가게 물량 확인 중", partially_refunded: "부분 환불", refunded: "환불 완료", pickup_ready: "확정 · 확인서 발급", picked_up: "픽업 완료", auto_completed: "자동 완료" };
const activeStatuses = new Set(["awaiting_payment", "paid_recruiting", "slot_confirmed", "store_checking", "pickup_ready", "partially_refunded", "picked_up"]);

function upcomingDates() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const today = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  const customerDates = (["수요일", "토요일"] as PickupDay[]).map((day) => ({ day, date: nextPickupDate(day), previous: false }));
  const previousDate = new Date(today);
  for (let daysBack = 1; daysBack <= 7; daysBack += 1) {
    const candidate = new Date(today);
    candidate.setUTCDate(candidate.getUTCDate() - daysBack);
    if (candidate.getUTCDay() === 3 || candidate.getUTCDay() === 6) {
      previousDate.setTime(candidate.getTime());
      break;
    }
  }
  const previousDay: PickupDay = previousDate.getUTCDay() === 3 ? "수요일" : "토요일";
  const previousPickup = { day: previousDay, date: [previousDate.getUTCFullYear(), String(previousDate.getUTCMonth() + 1).padStart(2, "0"), String(previousDate.getUTCDate()).padStart(2, "0")].join("-"), previous: true };
  return [...customerDates, previousPickup].sort((a, b) => a.date.localeCompare(b.date));
}

function productQuantityExpression(specification: string, quantity: number) {
  return `${specification.trim() ? `${specification.trim()} × ` : ""}${quantity}개`;
}

function slotQuantityExpression(specification: string, slotSize: number, sets: number) {
  return `${specification.trim() ? `${specification.trim()} × ` : ""}${slotSize}개 × ${sets}세트 (${slotSize * sets}개 상품)`;
}

export function AdminOrders() {
  const dates = useMemo(() => upcomingDates(), []);
  const [pickupDate, setPickupDate] = useState(() => dates.find((entry) => !entry.previous)?.date ?? dates[0].date);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"summary" | "payment" | "refunds" | "transfers">("summary");
  const [notice, setNotice] = useState("");
  const [lineQuantities, setLineQuantities] = useState<Record<string, Record<string, number>>>({});
  const [refundReason, setRefundReason] = useState<Record<string, string>>({});
  const [confirmationNotes, setConfirmationNotes] = useState<Record<string, string>>({});
  const [inventoryModes, setInventoryModes] = useState<Record<string, "all" | "quantity" | "unavailable">>({});
  const [inventoryQuantities, setInventoryQuantities] = useState<Record<string, number>>({});
  const [savingInventory, setSavingInventory] = useState(false);
  const [finalizingAll, setFinalizingAll] = useState(false);
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
      supabase.from("orders").select("id,order_number,pickup_date,total,status,paid_at,inventory_reviewed_at,created_at,depositor_name,refund_bank,refund_account,refund_account_holder,payment_bank,payment_account,payment_account_holder,refund_preference,cancellation_requested_at,profiles(nickname),order_items(id,quantity,proposed_quantity,confirmed_quantity,refund_quantity,refund_reason,unit_price,products(id,name,specification,type,slot_size,stores(id,name))),refunds(id,reason,amount,message,transferred_at)").eq("pickup_date", pickupDate).order("created_at", { ascending: true }),
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
    setRefundReason((previous) => {
      const next = { ...previous };
      for (const order of loaded) if (!next[order.id]) {
        const reason = order.order_items.find((line) => line.refund_reason)?.refund_reason;
        if (reason) next[order.id] = reason;
      }
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
  const inventoryOrders = orders.filter((order) => Boolean(order.paid_at) && ["paid_recruiting", "slot_confirmed", "store_checking"].includes(order.status)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const draftOrders = inventoryOrders.filter((order) => Boolean(order.inventory_reviewed_at));
  const summary = new Map<string, ProductTotal>();
  for (const order of activeOrders) for (const line of order.order_items) {
    const key = `${line.products?.id ?? line.id}`;
    const type = line.products?.type ?? "instant";
    const item = summary.get(key) ?? { id: line.products?.id ?? key, type, slotSize: line.products?.slot_size ?? null, name: line.products?.name ?? "상품", specification: line.products?.specification ?? "", storeId: line.products?.stores?.id ?? "unassigned", store: line.products?.stores?.name ?? "가게 미지정", requested: 0, paid: 0, unpaid: 0, confirmed: 0, amount: 0, amountReady: true, slotCalculated: type !== "slot" };
    item.requested += line.quantity;
    if (order.paid_at || !["awaiting_payment"].includes(order.status)) {
      item.paid += line.quantity;
      if (type === "slot") {
        if (line.proposed_quantity === null && line.confirmed_quantity === null) { item.slotCalculated = false; item.amountReady = false; }
        else {
          const quantity = line.confirmed_quantity ?? line.proposed_quantity ?? 0;
          item.confirmed += quantity;
          item.amount += quantity * line.unit_price;
          if (line.confirmed_quantity === null) item.amountReady = false;
        }
      } else {
        const quantity = line.confirmed_quantity ?? lineQuantities[order.id]?.[line.id] ?? line.quantity;
        item.confirmed += quantity;
        item.amount += quantity * line.unit_price;
        if (line.confirmed_quantity === null) item.amountReady = false;
      }
    } else item.unpaid += line.quantity;
    summary.set(key, item);
  }
  const productTotals = [...summary.values()].sort((a, b) => a.store.localeCompare(b.store) || a.name.localeCompare(b.name));
  const storeTotals = [...productTotals.reduce((groups, item) => {
    const group = groups.get(item.storeId) ?? { id: item.storeId, name: item.store, products: [] as ProductTotal[], amount: 0, amountReady: true };
    group.products.push(item);
    group.amount += item.amount;
    group.amountReady = group.amountReady && item.amountReady;
    groups.set(item.storeId, group);
    return groups;
  }, new Map<string, { id: string; name: string; products: ProductTotal[]; amount: number; amountReady: boolean }>()).values()].sort((a, b) => a.name.localeCompare(b.name));
  const paymentOrders = orders.filter((order) => ["awaiting_payment", "cancelled_unpaid", "paid_recruiting", "slot_confirmed", "store_checking", "pickup_ready", "picked_up", "auto_completed"].includes(order.status) || Boolean(order.cancellation_requested_at) || order.refunds?.some((refund) => !refund.transferred_at));
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
    const reason = lines.find((line) => line.refund_reason)?.refund_reason ?? order.refunds?.[0]?.reason ?? refundReason[order.id] ?? (order.cancellation_requested_at ? "customer_cancelled" : "quantity_unavailable");
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
    const { error } = await supabase.from("orders").update({ ...values, updated_at: new Date().toISOString() }).eq("id", order.id);
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

  async function markDepositUnconfirmed(order: Order) {
    if (!window.confirm(`${order.order_number} 주문의 입금 내역을 찾지 못했습니다. 미입금 취소 처리할까요? 고객 주문 내역에 취소 사유가 표시되고 운영 집계에서 제외됩니다.`)) return;
    const updated = await updateOrder(order, { status: "cancelled_unpaid", cancelled_at: new Date().toISOString(), cancel_reason: "deposit_not_confirmed" });
    if (updated) setNotice(`${order.order_number} 주문을 입금 확인 불가 · 미입금 취소로 처리했어요.`);
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
    if (!await updateOrder(order, {})) return;
    setNotice(`${order.order_number} 환불 이체 기록을 저장했어요.`);
  }


  async function saveInventoryAndPrepareOrders() {
    if (!inventoryOrders.length) { setNotice("가게 물량 확인을 기다리는 입금 완료 주문이 없어요."); return; }
    const supabase = createClient();
    if (!supabase) return;
    setSavingInventory(true);
    const productLines = new Map<string, { order: Order; line: Line }[]>();
    for (const order of inventoryOrders) for (const line of order.order_items) {
      const productId = line.products?.id;
      if (!productId) continue;
      const entries = productLines.get(productId) ?? [];
      entries.push({ order, line }); productLines.set(productId, entries);
    }
    const cancelled = new Set<string>();
    let planned: Record<string, Record<string, number>> = {};
    const capFor = (productId: string, lines: { order: Order; line: Line }[]) => {
      const requested = lines.reduce((sum, entry) => sum + entry.line.quantity, 0);
      const product = lines[0]?.line.products;
      const mode = inventoryModes[productId] ?? "all";
      const raw = mode === "unavailable" ? 0 : mode === "quantity" ? Math.max(0, Math.min(requested, Number(inventoryQuantities[productId] ?? 0))) : requested;
      return product?.type === "slot" && product.slot_size ? Math.floor(raw / product.slot_size) * product.slot_size : raw;
    };
    for (let attempt = 0; attempt <= inventoryOrders.length; attempt += 1) {
      planned = Object.fromEntries(inventoryOrders.map((order) => [order.id, Object.fromEntries(order.order_items.map((line) => [line.id, 0]))]));
      for (const [productId, allLines] of productLines) {
        const lines = allLines.filter(({ order }) => !cancelled.has(order.id));
        const requested = lines.reduce((sum, entry) => sum + entry.line.quantity, 0);
        const rawCapacity = capFor(productId, allLines);
        const isSlot = allLines[0]?.line.products?.type === "slot";
        const slotSize = allLines[0]?.line.products?.slot_size ?? 1;
        let remaining = isSlot ? Math.floor(Math.min(rawCapacity, requested) / slotSize) * slotSize : Math.min(rawCapacity, requested);
        for (const { order, line } of lines) {
          const confirmed = Math.min(line.quantity, remaining);
          planned[order.id][line.id] = confirmed;
          remaining -= confirmed;
        }
      }
      const newlyCancelled = inventoryOrders.filter((order) => order.refund_preference === "all_or_nothing" && !cancelled.has(order.id) && order.order_items.some((line) => (planned[order.id]?.[line.id] ?? 0) < line.quantity));
      if (!newlyCancelled.length) break;
      newlyCancelled.forEach((order) => cancelled.add(order.id));
    }
    for (const order of cancelled) for (const line of inventoryOrders.find((item) => item.id === order)?.order_items ?? []) planned[order][line.id] = 0;
    const reasons: Record<string, string> = {};
    for (const order of inventoryOrders) {
      const shortLines = order.order_items.filter((line) => (planned[order.id]?.[line.id] ?? 0) < line.quantity);
      const first = shortLines[0];
      if (first) {
        const slotSize = first.products?.slot_size ?? 0;
        const productId = first.products?.id;
        const cap = productId ? capFor(productId, productLines.get(productId) ?? []) : 0;
        reasons[order.id] = first.products?.type === "slot" ? (cap < slotSize ? "slot_unfilled" : "slot_boundary") : "quantity_unavailable";
      }
    }
    setLineQuantities((current) => ({ ...current, ...planned }));
    setRefundReason((current) => ({ ...current, ...reasons }));
    const drafts = inventoryOrders.map((order) => ({ order_id: order.id, refund_reason: reasons[order.id] ?? "quantity_unavailable", items: order.order_items.map((line) => ({ order_item_id: line.id, proposed_quantity: planned[order.id][line.id] })) }));
    const productInventory = [...productLines].map(([productId, lines]) => {
      const requested = lines.reduce((sum, entry) => sum + entry.line.quantity, 0);
      const mode = inventoryModes[productId] ?? "all";
      const available = mode === "unavailable" ? 0 : mode === "quantity" ? Math.max(0, Math.min(requested, Number(inventoryQuantities[productId] ?? 0))) : requested;
      return { product_id: productId, available_quantity: available };
    });
    const { error: orderFailure } = await supabase.rpc("prepare_pickup_order_drafts", { p_pickup_date: pickupDate, p_drafts: drafts, p_product_inventory: productInventory });
    setSavingInventory(false);
    if (orderFailure) { setNotice(`상품별 1차 확정 수량을 저장하지 못했어요: ${orderFailure.message}`); return; }
    setNotice("상품별 물량을 선착순으로 배분하고 주문서를 1차 확정했어요. 아래에서 주문별 수량과 비고를 검토한 뒤 전체 확정할 수 있습니다.");
    await load();
  }

  async function saveDraftOrder(order: Order) {
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("prepare_pickup_order_drafts", { p_pickup_date: pickupDate, p_drafts: [{ order_id: order.id, refund_reason: refundReason[order.id] ?? "quantity_unavailable", items: order.order_items.map((line) => ({ order_item_id: line.id, proposed_quantity: Math.min(line.quantity, Math.max(0, Number(lineQuantities[order.id]?.[line.id] ?? line.proposed_quantity ?? line.quantity))) })) }], p_product_inventory: [] });
    setNotice(error ? `주문 초안을 저장하지 못했어요: ${error.message}` : `${order.order_number} 주문별 검토 내용을 저장했어요.`);
    if (!error) await load();
  }

  async function finalizeAllDraftOrders() {
    const supabase = createClient();
    if (!supabase || !draftOrders.length) return;
    if (!window.confirm(`${draftOrders.length}건의 1차 확정 주문을 최종 확정하고 주문확인서를 발급할까요? 부족 수량의 환불 내역도 함께 기록됩니다.`)) return;
    setFinalizingAll(true);
    const payload = draftOrders.map((order) => ({
      order_id: order.id,
      refund_reason: refundReason[order.id] ?? order.order_items.find((line) => line.refund_reason)?.refund_reason ?? "quantity_unavailable",
      confirmation_note: confirmationNotes[order.id]?.trim() ?? "",
      confirmed_items: order.order_items.map((line) => ({ order_item_id: line.id, confirmed_quantity: Math.min(line.quantity, Math.max(0, Number(lineQuantities[order.id]?.[line.id] ?? line.proposed_quantity ?? line.quantity))) })),
    }));
    const { error } = await supabase.rpc("finalize_pickup_order_batch", { p_pickup_date: pickupDate, p_orders: payload });
    setFinalizingAll(false);
    if (error) { setNotice(`전체 확정을 완료하지 못했어요. 주문은 변경되지 않았습니다: ${error.message}`); return; }
    setNotice(`${draftOrders.length}건을 최종 확정하고 주문확인서를 발급했어요.`);
    await load();
  }

  return <div className="admin-ops">
    <form className="admin-card admin-fields" onSubmit={(event) => void savePaymentSetting(event)}><h2>고객 입금 계좌 설정</h2><div className="admin-field-pair"><div className="admin-field"><label htmlFor="payment-bank">은행</label><input id="payment-bank" value={paymentSetting.bank_name} onChange={(event) => setPaymentSetting((value) => ({ ...value, bank_name: event.target.value }))} required/></div><div className="admin-field"><label htmlFor="payment-holder">예금주</label><input id="payment-holder" value={paymentSetting.account_holder} onChange={(event) => setPaymentSetting((value) => ({ ...value, account_holder: event.target.value }))} required/></div></div><div className="admin-field"><label htmlFor="payment-account">입금 계좌번호</label><input id="payment-account" value={paymentSetting.account_number} onChange={(event) => setPaymentSetting((value) => ({ ...value, account_number: event.target.value }))} inputMode="numeric" required/></div><div className="admin-field"><label htmlFor="payment-memo">입금 안내</label><input id="payment-memo" value={paymentSetting.memo} onChange={(event) => setPaymentSetting((value) => ({ ...value, memo: event.target.value }))}/></div><button className="admin-save" disabled={savingPayment}>{savingPayment ? "저장 중…" : "입금 계좌 저장"}</button></form>
    <section className="admin-card"><div className="ops-date-title"><div><h2>픽업 주문 운영</h2><p>{formatPickupDate(pickupDate)} 기준</p></div><button className="ops-refresh" onClick={() => void load()}><RefreshCw size={14}/>새로고침</button></div>
      <div className="ops-date-picker">{dates.filter(({ previous }) => !previous).map(({ day, date }) => <button key={date} className={pickupDate === date ? "selected" : ""} onClick={() => setPickupDate(date)}><b>{day}</b><small>{formatPickupDate(date)}</small></button>)}</div>
      <label className="ops-history-date"><span>지난 픽업일 조회</span><input type="date" value={pickupDate} onChange={(event) => { const date = event.target.value; if (!date) return; const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); if (weekday !== 3 && weekday !== 6) { setNotice("픽업 운영일인 수요일 또는 토요일을 선택해 주세요."); return; } setNotice(""); setPickupDate(date); }}/><small>달력에서 과거 수요일·토요일을 선택하면 해당 날짜의 주문과 운영 정보를 볼 수 있어요.</small></label>
      <p className="admin-help">테스트 모드: 주문·취소·슬롯 확정·최종 수량 처리의 시간 제한을 임시 해제했어요.</p>
      {notice && <div className="admin-notice">{notice}</div>}
      <div className="ops-tabs"><button className={tab === "summary" ? "selected" : ""} onClick={() => setTab("summary")}><PackageCheck size={14}/>주문 집계</button><button className={tab === "payment" ? "selected" : ""} onClick={() => setTab("payment")}><CircleDollarSign size={14}/>입금 확인</button><button className={tab === "refunds" ? "selected" : ""} onClick={() => setTab("refunds")}>환불 정리</button><button className={tab === "transfers" ? "selected" : ""} onClick={() => setTab("transfers")}>청과점 이체</button></div>
    </section>
    {tab === "summary" ? <>
      <div className="ops-metrics"><article><span>유효 주문</span><b>{activeOrders.length}건</b><small>{won(activeOrders.reduce((sum, order) => sum + order.total, 0))}원</small></article><article><span>입금 확인</span><b>{paidOrders.filter((order) => activeStatuses.has(order.status)).length}건</b><small>{won(paidOrders.filter((order) => activeStatuses.has(order.status)).reduce((sum, order) => sum + order.total, 0))}원</small></article><article><span>입금 대기</span><b>{orders.filter((order) => order.status === "awaiting_payment").length}건</b><small>{won(orders.filter((order) => order.status === "awaiting_payment").reduce((sum, order) => sum + order.total, 0))}원</small></article></div>
      <section className="admin-card inventory-review"><div className="ops-date-title"><div><h2>가게 물량 확인 · 상품별 1차 확정</h2><p>입금 완료 상품을 등록 순서대로 배분합니다.</p></div><span className="inventory-count">{inventoryOrders.length}건</span></div>
        <p className="admin-help">가능 수량은 과일 낱개 수가 아니라 등록된 상품 단위로 입력해 주세요. 예: 사과 2과 1상품을 3상품 준비할 수 있으면 3을 입력합니다. 슬롯 상품은 슬롯 단위 경계를 지키며 배분하고, 1세트도 채우지 못하면 구매 불가로 표시합니다.</p>
        {productTotals.filter((item) => inventoryOrders.some((order) => order.order_items.some((line) => line.products?.id === item.id))).length ? <div className="inventory-product-list">{productTotals.filter((item) => inventoryOrders.some((order) => order.order_items.some((line) => line.products?.id === item.id))).map((item) => {
          const requested = inventoryOrders.reduce((sum, order) => sum + order.order_items.filter((line) => line.products?.id === item.id).reduce((lineSum, line) => lineSum + line.quantity, 0), 0);
          const mode = inventoryModes[item.id] ?? "all";
          const available = mode === "unavailable" ? 0 : mode === "quantity" ? Number(inventoryQuantities[item.id] ?? 0) : requested;
          const impossible = item.type === "slot" && (available < (item.slotSize ?? 1) || requested < (item.slotSize ?? 1));
          return <article className="inventory-product-row" key={item.id}><div className="inventory-product-info"><b>{item.store} · {item.name}</b><small>{item.specification} · {item.type === "slot" ? `슬롯 ${item.slotSize}상품 단위` : "즉시 구매"} · 주문 {requested}상품</small>{impossible && <strong className="inventory-unavailable">구매 불가 · 슬롯 1세트 미달</strong>}</div><div className="inventory-product-controls"><select aria-label={`${item.name} 물량 가능 여부`} value={mode} onChange={(event) => setInventoryModes((values) => ({ ...values, [item.id]: event.target.value as "all" | "quantity" | "unavailable" }))}><option value="all">전체 물량 가능 ({requested})</option><option value="quantity">가능한 상품 수 입력</option><option value="unavailable">전체 물량 불가</option></select>{mode === "quantity" && <label><input type="number" min="0" max={requested} inputMode="numeric" value={inventoryQuantities[item.id] ?? ""} onChange={(event) => setInventoryQuantities((values) => ({ ...values, [item.id]: Math.max(0, Number(event.target.value)) }))}/><span>상품</span></label>}</div></article>;
        })}</div> : <div className="admin-empty">물량을 확인할 입금 완료 주문이 없어요.</div>}
        <button className="ops-action primary" style={{ marginTop: 12 }} disabled={!inventoryOrders.length || savingInventory} onClick={() => void saveInventoryAndPrepareOrders()}><PackageCheck size={15}/>{savingInventory ? "1차 확정 저장 중…" : "물량 저장 · 주문서 1차 확정"}</button>
      </section>
      <section className="admin-card"><h2>청과점별 상품 주문 총량 · 보낼 금액</h2><p className="admin-help">청과점별로 상품 수량을 모아 표시합니다. 금액은 주문에 저장된 판매 단가 × 1차 확인 수량 합계입니다. 입금 확인 전 주문은 금액 합계에서 제외합니다.</p>{loading ? <div className="admin-empty">집계 중…</div> : storeTotals.length ? <div className="ops-summary-list">{storeTotals.map((store) => <article className="supply-summary-row" key={store.id}><div><b>{store.name}</b><span className="store-order-breakdown">{store.products.map((item) => {
        const slotSize = item.slotSize ?? 1;
        const confirmedSets = Math.floor(item.confirmed / slotSize);
        const possibleSets = Math.floor(item.paid / slotSize);
        const quantityText = item.type === "slot" ? item.slotCalculated ? slotQuantityExpression(item.specification, slotSize, confirmedSets) : `슬롯 확정 대기 · ${slotQuantityExpression(item.specification, slotSize, possibleSets)} 가능` : productQuantityExpression(item.specification, item.confirmed);
        return <span className="store-order-product" key={item.id}><b>{item.name}</b><small>{quantityText} · {won(item.amount)}원</small>{item.type === "slot" && item.slotCalculated && <small>가게 확인 제외: {productQuantityExpression(item.specification, Math.max(0, item.paid - item.confirmed))}</small>}{item.unpaid > 0 && <small>입금 대기 주문 {productQuantityExpression(item.specification, item.unpaid)} (금액 합계 제외)</small>}</span>;
      })}</span><small>{store.products.every((item) => item.paid === 0) ? "입금 확인된 주문 없음" : store.amountReady ? "최종 확정 수량 기준 · 저장된 판매 단가 합계" : "현재 확인 대상 기준 예상 금액 · 최종 수량 확정 후 금액 갱신"}</small></div><strong className="store-order-total"><small>{store.products.every((item) => item.paid === 0) ? "계산 대기" : store.amountReady ? "청과점에 보낼 금액" : "예상 보낼 금액"}</small>{won(store.amount)}원</strong></article>)}</div> : <div className="admin-empty">이 픽업일의 주문이 없어요.</div>}</section>
      <section className="admin-card draft-review"><div className="ops-date-title"><div><h2>1차 확정 주문서 검토</h2><p>주문별 상품 수량을 수정하고 비고를 적은 뒤 전체 확정합니다.</p></div><span className="inventory-count">{draftOrders.length}건</span></div>
        {draftOrders.length ? <><div className="ops-order-list">{draftOrders.map((order) => <article className="ops-order-card draft-order-card" key={order.id}>
          <div className="ops-order-head"><div><b>{order.order_number}</b><small>{order.profiles?.nickname ?? "고객"} · {order.depositor_name} · {won(order.total)}원 주문</small></div><span className="order-status ready">1차 확정 · 검토</span></div>
          <div className="ops-finalize">{order.order_items.map((line) => { const proposed = line.proposed_quantity ?? line.quantity; return <label className="draft-quantity-row" key={line.id}><span><b>{line.products?.name ?? "상품"}</b><small>{line.products?.stores?.name ?? "가게 미지정"} · 주문 {productQuantityExpression(line.products?.specification ?? "", line.quantity)} · 1차 {productQuantityExpression(line.products?.specification ?? "", proposed)}</small></span><input type="number" min={0} max={line.quantity} value={Math.min(line.quantity, Math.max(0, Number(lineQuantities[order.id]?.[line.id] ?? proposed)))} onChange={(event) => setLineQuantities((values) => ({ ...values, [order.id]: { ...values[order.id], [line.id]: Number(event.target.value) } }))}/></label>; })}
            <select aria-label="환불 사유" value={refundReason[order.id] ?? order.order_items.find((line) => line.refund_reason)?.refund_reason ?? "quantity_unavailable"} onChange={(event) => setRefundReason((values) => ({ ...values, [order.id]: event.target.value }))}><optgroup label="슬롯 모집 결과"><option value="slot_unfilled">1세트 미달 · 모집량이 1세트를 채우지 못함</option><option value="slot_boundary">세트 잔여 · 다음 세트 미달</option></optgroup><optgroup label="가게 사정"><option value="quantity_unavailable">가게 수량 확보 불가</option><option value="quality">품질 기준 미충족</option><option value="price_limit">가격 기준 초과</option><option value="urgent_store_unreachable">가게 연락 불가</option></optgroup></select>
            <label className="ops-note-field"><span>주문서 비고 <small>선택 입력 · 비워두면 비고 없이 발급</small></span><textarea value={confirmationNotes[order.id] ?? ""} onChange={(event) => setConfirmationNotes((values) => ({ ...values, [order.id]: event.target.value }))} maxLength={500} placeholder=""/></label>
            <small>{order.refund_preference === "all_or_nothing" ? "전체 환불 선택: 수량이 부족한 품목이 있으면 이 주문 전체가 환불됩니다." : "일부 환불 선택: 부족한 상품만 환불하고 확보한 다른 상품은 유지합니다."}</small>
            <button className="ops-action" onClick={() => void saveDraftOrder(order)}>이 주문 변경사항 저장</button>
          </div>
        </article>)}</div><button className="ops-action primary" style={{ marginTop: 12 }} disabled={finalizingAll} onClick={() => void finalizeAllDraftOrders()}><PackageCheck size={15}/>{finalizingAll ? "전체 확정 처리 중…" : `전체 확정 · 주문확인서 발급 (${draftOrders.length}건)`}</button><p className="admin-help">전체 확정 시 모든 주문과 환불 내역이 한 번에 저장됩니다. 한 건이라도 처리할 수 없으면 전체 변경이 취소됩니다.</p></> : <div className="admin-empty">아직 검토할 1차 확정 주문이 없습니다. 위에서 상품 물량을 저장해 주세요.</div>}
      </section>
    </> : tab === "payment" ? <section className="admin-card"><h2>주문 목록 · 입금 확인</h2><p className="admin-help">입금 확인부터 픽업 완료까지 이 날짜의 주문을 여기서 확인할 수 있어요. 상품 물량 입력과 주문서 검토·최종 확정은 주문 집계 탭에서 진행합니다.</p>{loading ? <div className="admin-empty">주문을 불러오고 있어요…</div> : paymentOrders.length ? <div className="ops-order-list">{paymentOrders.map((order) => <article className="ops-order-card" key={order.id}>
      <div className="ops-order-head"><div><b>{order.order_number}</b><small>{order.profiles?.nickname ?? "고객"} · {order.depositor_name} · {new Date(order.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div><span className={`order-status ${order.paid_at ? "ready" : ""}`}>{statusText[order.status] ?? order.status}</span></div>
      <div className="ops-order-lines">{order.order_items.map((line) => <div key={line.id}><span>{line.products?.name ?? "상품"} · {line.quantity}개</span><small>{line.products?.stores?.name ?? "가게 미지정"}</small></div>)}</div>
      <div className="ops-payment-row"><span>입금자 <b>{order.depositor_name}</b></span><strong>{won(order.total)}원</strong></div>
      <div className="ops-transfer-instructions">입금 계좌: {order.payment_bank ? `${order.payment_bank} ${order.payment_account} · ${order.payment_account_holder}` : "계좌 설정 전 접수 주문"}</div>
      {!order.paid_at && order.status === "awaiting_payment" && <><button className="ops-action primary" onClick={() => void confirmDeposit(order)}><Check size={15}/>입금 확인</button><button className="ops-action danger" onClick={() => void markDepositUnconfirmed(order)}>입금 확인 불가</button></>}
      {order.cancellation_requested_at && order.status !== "refunded" && <div className="ops-cancel-request"><span>고객 취소·환불 요청</span><button className="ops-action danger" onClick={() => void finishCancellation(order)}>환불 이체 완료 처리</button></div>}
      {order.refunds?.filter((refund) => !refund.transferred_at).map((refund) => <div className="ops-cancel-request" key={refund.id}><span>환불 이체 대기 · {won(refund.amount)}원<br/>{refund.message}</span><button className="ops-action danger" onClick={() => void markRefundTransferred(order, refund)}>환불 이체 완료 처리</button></div>)}
      {order.inventory_reviewed_at && ["slot_confirmed", "store_checking"].includes(order.status) && <div className="ops-transfer-instructions">상품별 1차 확정 완료 · 주문 집계 탭에서 검토하고 전체 확정할 수 있어요.</div>}
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
