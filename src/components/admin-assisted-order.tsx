"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Minus, Plus, ShoppingBasket } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatPickupDate, nextPickupDate, type PickupDay } from "@/lib/pickup-dates";
import { won } from "@/lib/products";

type Store = { id: string; name: string; area: string; active: boolean; closed_weekdays: number[] };
type Product = { id: string; store_id: string; name: string; specification: string; consumer_price: number; type: "slot" | "instant"; slot_size: number | null; active: boolean; stores: Store | Store[] | null };
type CustomerProfile = { id: string; nickname: string; created_at: string };
const SOURCES = [
  ["friend_referral", "지인 추천"], ["kakao_group", "카카오톡 단체방"], ["search", "검색"],
  ["social_community", "SNS / 커뮤니티"], ["paid_ad", "광고"], ["store_offline", "가게 / 오프라인"],
  ["other", "기타"], ["unknown", "기억나지 않음"],
] as const;
const pickDates = [...new Set([nextPickupDate("수요일"), nextPickupDate("토요일")])].sort();

export function AdminAssistedOrder({ onCreated }: { onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pickupDate, setPickupDate] = useState(pickDates[0] ?? "");
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [buyerNickname, setBuyerNickname] = useState("");
  const [linkedProfile, setLinkedProfile] = useState("");
  const [source, setSource] = useState("");
  const [refundPreference, setRefundPreference] = useState<"partial" | "all_or_nothing">("partial");
  const [refundBank, setRefundBank] = useState("");
  const [refundAccount, setRefundAccount] = useState("");
  const [refundHolder, setRefundHolder] = useState("");
  const [depositorName, setDepositorName] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    setLoading(true);
    void Promise.all([
      supabase.from("products").select("id,store_id,name,specification,consumer_price,type,slot_size,active,stores(id,name,area,active,closed_weekdays)").eq("active", true).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,nickname,created_at").eq("role", "customer").neq("id", "f022cd30-1a39-457b-adaf-48f3c109965d").order("created_at", { ascending: false }).limit(500),
    ]).then(([productResult, customerResult]) => {
      setProducts((productResult.data ?? []) as unknown as Product[]);
      setCustomers((customerResult.data ?? []) as CustomerProfile[]);
      if (productResult.error) { setNotice("상품 목록을 불러오지 못했어요: " + productResult.error.message); setNoticeError(true); }
      setLoading(false);
    });
  }, []);

  const availableProducts = useMemo(() => products.filter((product) => {
    const store = Array.isArray(product.stores) ? product.stores[0] : product.stores;
    if (!store?.active) return false;
    const weekday = new Date(pickupDate + "T00:00:00Z").getUTCDay();
    return !store.closed_weekdays?.includes(weekday);
  }), [products, pickupDate]);
  const groupedProducts = useMemo(() => availableProducts.reduce<{ storeId: string; storeName: string; products: Product[] }[]>((groups, product) => {
    const store = Array.isArray(product.stores) ? product.stores[0] : product.stores;
    const id = store?.id ?? product.store_id;
    let group = groups.find((entry) => entry.storeId === id);
    if (!group) { group = { storeId: id, storeName: store?.name ?? "가게", products: [] }; groups.push(group); }
    group.products.push(product);
    return groups;
  }, []), [availableProducts]);
  const total = availableProducts.reduce((sum, product) => sum + product.consumer_price * (quantities[product.id] ?? 0), 0);
  const itemCount = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);

  function changeQuantity(productId: string, delta: number) {
    setQuantities((current) => {
      const next = Math.max(0, Math.min(100, (current[productId] ?? 0) + delta));
      return { ...current, [productId]: next };
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) { setNotice("Supabase 연결을 확인해 주세요."); setNoticeError(true); return; }
    const items = Object.entries(quantities).filter(([, quantity]) => quantity > 0).map(([product_id, quantity]) => ({ product_id, quantity }));
    if (!items.length) { setNotice("상품을 한 개 이상 선택해 주세요."); setNoticeError(true); return; }
    setSaving(true); setNotice("");
    const { data, error } = await supabase.rpc("create_assisted_order", {
      p_pickup_date: pickupDate,
      p_customer_nickname: buyerNickname.trim(),
      p_linked_profile_id: linkedProfile || null,
      p_acquisition_channel: source || null,
      p_refund_preference: refundPreference,
      p_refund_bank: refundBank.trim(),
      p_refund_account: refundAccount.trim(),
      p_refund_account_holder: refundHolder.trim(),
      p_depositor_name: depositorName.trim(),
      p_items: items,
    });
    setSaving(false);
    if (error) { setNotice(error.message); setNoticeError(true); return; }
    const created = Array.isArray(data) ? data[0] : data;
    setNotice(formatPickupDate(pickupDate) + " 대리 주문 " + (created?.order_number ?? "") + "을 등록했어요. 입금 확인은 주문 · 입금 탭에서 처리해 주세요.");
    setNoticeError(false); setQuantities({}); setBuyerNickname(""); setLinkedProfile(""); setSource("");
    setRefundBank(""); setRefundAccount(""); setRefundHolder(""); setDepositorName("");
    onCreated?.();
  }

  return <section className="admin-card assisted-order-card">
    <button className="assisted-order-toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <span className="assisted-order-icon"><ShoppingBasket size={19}/></span>
      <span><b>대리 주문 등록</b><small>웹을 이용하기 어려운 구매자의 주문을 대신 접수해요.</small></span>
      <span className="assisted-order-toggle-mark">{open ? "접기" : "열기"}</span>
    </button>
    {notice && <p className={"assisted-order-notice" + (noticeError ? " error" : "")} role="status">{!noticeError && <Check size={14}/>} {notice}</p>}
    {open && <form className="assisted-order-form" onSubmit={(event) => void submit(event)}>
      <div className="assisted-order-section-title"><b>1. 픽업일과 구매자</b><span>닉네임으로 같은 대리 구매자를 구분해요.</span></div>
      <div className="admin-field"><label htmlFor="assisted-pickup">픽업일</label><select id="assisted-pickup" value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} required>{pickDates.map((date) => { const day: PickupDay = new Date(date + "T00:00:00Z").getUTCDay() === 3 ? "수요일" : "토요일"; return <option key={date} value={date}>{formatPickupDate(date) + " · " + day}</option>; })}</select></div>
      <div className="admin-field"><label htmlFor="assisted-nickname">구매자 닉네임</label><input id="assisted-nickname" type="text" autoComplete="off" maxLength={40} value={buyerNickname} onChange={(event) => setBuyerNickname(event.target.value)} placeholder="구매자가 사용하는 닉네임" required/><small>같은 닉네임은 같은 구매자로 집계돼요. 동명이인은 구분되는 닉네임을 입력해 주세요.</small></div>
      <div className="admin-field"><label htmlFor="assisted-profile">연결할 맵소사 계정 (선택)</label><select id="assisted-profile" value={linkedProfile} onChange={(event) => setLinkedProfile(event.target.value)}><option value="">연결하지 않음 / 해당 계정 모름</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.nickname + " · 가입 " + new Date(customer.created_at).toLocaleDateString("ko-KR") + " · " + customer.id.slice(0, 6)}</option>)}</select><small>구매자가 기존 맵소사 계정 이용자임을 확인한 경우에만 연결하세요. 연결하면 직접 주문과 대리 주문을 같은 구매자로 분석해요.</small></div>
      <div className="admin-field"><label htmlFor="assisted-source">맵소사를 처음 알게 된 경로 (선택)</label><select id="assisted-source" value={source} onChange={(event) => setSource(event.target.value)}><option value="">확인하지 않음</option>{SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>구매자에게 확인한 경우에만 선택해 주세요.</small></div>

      <div className="assisted-order-section-title"><b>2. 주문 상품</b><span>가게별 상품 가격은 고객 화면과 동일하게 적용돼요.</span></div>
      {loading ? <div className="admin-empty">상품을 불러오고 있어요…</div> : groupedProducts.length ? <div className="assisted-product-groups">{groupedProducts.map((group) => <div className="assisted-product-group" key={group.storeId}><h3>{group.storeName}</h3>{group.products.map((product) => <div className="assisted-product-row" key={product.id}><div><b>{product.name}</b><small>{product.specification} · {product.type === "slot" ? "슬롯 " + product.slot_size + "개 단위 · " : ""}{won(product.consumer_price)}원</small></div><div className="assisted-product-qty"><button type="button" onClick={() => changeQuantity(product.id, -1)} aria-label={product.name + " 수량 줄이기"}><Minus size={14}/></button><span>{quantities[product.id] ?? 0}</span><button type="button" onClick={() => changeQuantity(product.id, 1)} aria-label={product.name + " 수량 늘리기"}><Plus size={14}/></button></div></div>)}</div>)}</div> : <div className="admin-empty">선택한 픽업일에 주문할 수 있는 상품이 없어요.</div>}

      <div className="assisted-order-section-title"><b>3. 입금·환불 정보</b><span>고객이 알려준 정보를 입력해 주세요.</span></div>
      <div className="admin-field"><label>상품 부족 시 처리 방식</label><div className="admin-segmented">{([["partial", "가능한 상품은 유지"], ["all_or_nothing", "주문 전체 환불"]] as const).map(([value, label]) => <button key={value} type="button" className={refundPreference === value ? "selected" : ""} onClick={() => setRefundPreference(value)}>{label}</button>)}</div></div>
      <div className="bank-input-grid assisted-bank-grid"><input aria-label="환불 은행명" placeholder="환불 은행명" value={refundBank} onChange={(event) => setRefundBank(event.target.value)} required/><input aria-label="환불 계좌번호" placeholder="환불 계좌번호" inputMode="numeric" value={refundAccount} onChange={(event) => setRefundAccount(event.target.value)} required/><input aria-label="환불 예금주" placeholder="환불 예금주" value={refundHolder} onChange={(event) => setRefundHolder(event.target.value)} required/><input aria-label="입금자명" placeholder="입금자명" value={depositorName} onChange={(event) => setDepositorName(event.target.value)} required/></div>
      <p className="admin-help">예약 접수 후 입금 확인 전까지는 대기 주문으로 표시됩니다. 닉네임은 같은 구매자의 대리 주문을 연결하고 재주문 분석에 사용하며, 운영자 화면에서만 확인할 수 있습니다.</p>
      <div className="assisted-order-total"><span>{itemCount}개 상품</span><b>예상 입금액 {won(total)}원</b></div>
      <button className="admin-save" type="submit" disabled={saving || loading || !itemCount}>{saving ? "주문 등록 중…" : "대리 주문 접수"}</button>
    </form>}
  </section>;
}
