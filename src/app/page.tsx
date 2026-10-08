"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, Check, Clock3, MapPin, Minus, Plus, ShoppingBag, Sprout, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { won, type Product } from "@/lib/products";

type PickupDay = "수요일" | "토요일";

export default function Home() {
  const [pickup, setPickup] = useState<PickupDay>("수요일");
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [checkout, setCheckout] = useState(false);
  const [refund, setRefund] = useState<"all" | "partial">("partial");
  const [refundBank, setRefundBank] = useState("");
  const [refundAccount, setRefundAccount] = useState("");
  const [refundHolder, setRefundHolder] = useState("");
  const [depositorName, setDepositorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<"checking" | "signed_in" | "signed_out">("checking");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("mapsosa-cart-v1");
      if (saved) setCart(JSON.parse(saved) as Record<string, number>);
    } catch { window.localStorage.removeItem("mapsosa-cart-v1"); }
  }, []);
  useEffect(() => { window.localStorage.setItem("mapsosa-cart-v1", JSON.stringify(cart)); }, [cart]);
  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("auth_error");
    if (!error) return;
    const messages: Record<string, string> = {
      kakao_cancelled: "카카오 로그인을 취소했어요.",
      kakao_state_mismatch: "로그인 확인이 만료됐어요. 다시 시도해 주세요.",
      kakao_code_missing: "카카오 인증 코드를 받지 못했어요. 다시 시도해 주세요.",
      kakao_not_configured: "카카오 로그인 설정이 배포 환경에 없습니다.",
      kakao_token_unreachable: "카카오 인증 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
      kakao_token_rejected: "카카오 인증 코드 교환에 실패했어요. REST API 키와 Client Secret을 확인해 주세요.",
      kakao_openid_missing: "카카오에서 OpenID 토큰을 받지 못했어요. Kakao Developers에서 OpenID Connect를 켜 주세요.",
      supabase_not_configured: "Supabase 인증 환경변수가 배포 환경에 없습니다.",
      supabase_rejected_kakao_token: "Supabase가 카카오 토큰을 거부했어요. Supabase의 Kakao 제공자 설정과 REST API 키가 같은지 확인해 주세요.",
    };
    setToast(messages[error] ?? "로그인에 실패했어요. 다시 시도해 주세요.");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) { setAuthStatus("signed_out"); return; }
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (active) setAuthStatus(data.user ? "signed_in" : "signed_out");
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthStatus(session?.user ? "signed_in" : "signed_out");
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    void supabase.from("products").select("id,name,specification,consumer_price,type,slot_size,description,image_url,stores(name,area,closed_weekdays),price_comparisons(price)").eq("active", true).then(({ data }) => {
      if (!active) return;
      if (data) {
        const dayIndex = pickup === "수요일" ? 3 : 6;
        setCatalog(data.flatMap((row) => {
          const store = (Array.isArray(row.stores) ? row.stores[0] : row.stores) as { name?: string; area?: string; closed_weekdays?: number[] } | null;
          if (!store || store.closed_weekdays?.includes(dayIndex)) return [];
          const comparisons = (row.price_comparisons ?? []) as { price: number }[];
          const comparisonPrice = comparisons.length ? Math.max(...comparisons.map((entry) => entry.price)) : row.consumer_price;
          const isFruit = /사과|배|포도|키위|딸기|귤|한라봉|복숭아|수박|참외/.test(row.name);
          const emoji = /사과/.test(row.name) ? "🍎" : /포도/.test(row.name) ? "🍇" : /딸기/.test(row.name) ? "🍓" : /배/.test(row.name) ? "🍐" : isFruit ? "🍊" : "🥬";
          return [{ id: row.id, name: row.name, variety: row.specification, store: store.name ?? "동네 청과점", area: store.area ?? "우리 동네", price: row.consumer_price, oldPrice: comparisonPrice, unit: row.specification, type: row.type, slotSize: row.slot_size ?? undefined, applied: 0, image: row.image_url || emoji, note: row.description || "동네 청과점에서 정성껏 준비했어요", tag: row.type === "slot" ? "공동구매" : "바로 구매", pickup }];
        }));
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [pickup]);

  const count = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const cartItems = catalog.filter((product) => cart[product.id]);
  const total = cartItems.reduce((sum, product) => sum + product.price * cart[product.id], 0);
  const soonestDate = useMemo(() => {
    const date = new Date();
    const day = pickup === "수요일" ? 3 : 6;
    let days = (day - date.getDay() + 7) % 7;
    if (!days) days = 7;
    date.setDate(date.getDate() + days);
    return `${date.getMonth() + 1}. ${date.getDate()}.`;
  }, [pickup]);

  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2600); }
  function changeQuantity(id: string, amount: number) {
    setCart((current) => {
      const quantity = Math.max(0, (current[id] ?? 0) + amount);
      const updated = { ...current };
      if (quantity) updated[id] = quantity; else delete updated[id];
      return updated;
    });
  }
  async function signIn() {
    const supabase = createClient();
    if (!supabase) { notify("Supabase와 카카오 로그인 설정을 먼저 완료해 주세요"); return; }
    window.location.assign("/auth/kakao/start?next=/");
  }
  async function signOut() {
    const supabase = createClient();
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) notify("로그아웃하지 못했어요. 다시 시도해 주세요.");
  }
  async function placeOrder() {
    if (!refundBank.trim() || !refundAccount.trim() || !refundHolder.trim() || !depositorName.trim()) { notify("환불 계좌와 입금자 정보를 입력해 주세요"); return; }
    const supabase = createClient();
    if (!supabase) { notify("Supabase 설정 후 주문할 수 있어요"); return; }
    setSubmitting(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) { await signIn(); return; }
      const date = new Date();
      const targetDay = pickup === "수요일" ? 3 : 6;
      let delta = (targetDay - date.getDay() + 7) % 7;
      if (!delta) delta = 7;
      date.setDate(date.getDate() + delta);
      const pickupDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const { data: round } = await supabase.from("pickup_rounds").select("id").eq("pickup_date", pickupDate).maybeSingle();
      if (!round) { notify("아직 해당 픽업 회차가 열리지 않았어요"); return; }
      const { data, error } = await supabase.rpc("create_order", {
        p_round_id: round.id,
        p_refund_preference: refund === "partial" ? "partial" : "all_or_nothing",
        p_refund_bank: refundBank,
        p_refund_account: refundAccount,
        p_refund_account_holder: refundHolder,
        p_depositor_name: depositorName,
        p_items: cartItems.map((item) => ({ product_id: item.id, quantity: cart[item.id] })),
      });
      if (error) { notify(error.message); return; }
      const result = Array.isArray(data) ? data[0] : data;
      setCart({}); setCheckout(false);
      notify(`주문 ${result?.order_number ?? "접수"} · 1시간 안에 입금해 주세요`);
    } finally { setSubmitting(false); }
  }

  return <main className="mobile-app">
    <header className="mobile-header">
      <a className="mobile-brand" href="/" aria-label="맵소사 홈"><span className="mobile-brand-mark"><Sprout size={18}/></span>맵소사</a>
      <div className="mobile-header-actions"><a className="admin-link" href="/admin">관리자</a><button className="header-cart" onClick={() => setCheckout(true)} aria-label={`장바구니 ${count}개`}><ShoppingBag size={19}/>{count > 0 && <span>{count}</span>}</button></div>
    </header>

    <div className="mobile-content">
      <section className="mobile-intro">
        <span className="intro-label">동네 청과 공동구매</span>
        <h1>딱 먹을 만큼만,<br/>동네에서 나눠 사요</h1>
        <p>근처 가게 상품을 필요한 만큼 함께 예약해요.</p>
      </section>

      <section className="pickup-panel" aria-label="픽업일 선택">
        <div><b>어느 날 픽업할까요?</b><span>수요일과 토요일에 만나요</span></div>
        <div className="day-picker">{(["수요일", "토요일"] as PickupDay[]).map((day) => <button key={day} className={pickup === day ? "day-selected" : ""} onClick={() => setPickup(day)}>{day}</button>)}</div>
      </section>

      <section className="mobile-market">
        <div className="mobile-section-heading"><div><span className="section-kicker">THIS WEEK</span><h2>이번 주 상품</h2></div><span className="date-chip"><Clock3 size={13}/>{soonestDate} 픽업</span></div>
        {loading ? <div className="mobile-empty">상품을 불러오고 있어요…</div> : catalog.length ? <div className="mobile-product-list">{catalog.map((product) => {
          const imageIsUrl = product.image.startsWith("http");
          return <article className="mobile-product-card" key={product.id}>
            <div className="mobile-product-top"><span className="product-kind">{product.type === "slot" ? "공동구매" : "바로 구매"}</span><span className="product-status">모집 중</span><span className="product-deadline">{soonestDate} 마감</span></div>
            <div className="mobile-product-body"><div className="mobile-product-main"><h3>{product.name} <span>{product.variety}</span></h3><strong>{won(product.price)}원</strong>{product.type === "slot" && product.slotSize && <><div className="mobile-progress"><span style={{ width: `${Math.min(100, (product.applied % product.slotSize) / product.slotSize * 100 || 28)}%` }}/></div><p className="progress-caption"><b>{product.applied}/{product.slotSize} 예약됨</b><span>· {Math.max(0, product.slotSize - product.applied % product.slotSize)}자리 남음</span></p></>}</div><div className="mobile-fruit" aria-hidden="true">{imageIsUrl ? <img src={product.image} alt=""/> : product.image}</div></div>
            <div className="mobile-product-bottom"><div className="mobile-store"><MapPin size={14}/><b>{product.store}</b><span>· {product.area}</span></div><button className="reserve-button" onClick={() => { changeQuantity(product.id, 1); notify(`${product.name}을(를) 담았어요`); }}>{cart[product.id] ? `${cart[product.id]}개 담김` : "예약하기"}<Plus size={15}/></button></div>
          </article>;
        })}</div> : <div className="mobile-empty"><span>🍐</span><b>아직 등록된 상품이 없어요</b><p>관리자가 상품을 등록하면 이곳에 보여요.</p><a href="/admin">관리자 상품 등록 <ArrowRight size={14}/></a></div>}
      </section>

      <section className="mobile-start">{authStatus === "signed_in" ? <><div className="kakao-start kakao-authenticated" role="status">카카오 로그인 완료</div><button className="kakao-logout" onClick={() => void signOut()}>로그아웃</button></> : <button className="kakao-start" onClick={signIn} disabled={authStatus === "checking"}>{authStatus === "checking" ? "로그인 확인 중…" : "카카오로 시작하기"}</button>}<p>{authStatus === "signed_in" ? "로그인 상태로 예약을 진행할 수 있어요." : "처음 방문하셨나요? 카카오 계정으로 바로 가입할 수 있어요."}</p></section>
      <footer className="mobile-footer">© 2026 MAPSOSA · 동네에서 나눠 사는 즐거움</footer>
    </div>

    {count > 0 && <button className="mobile-floating-cart" onClick={() => setCheckout(true)}><span><ShoppingBag size={17}/><b>{count}</b></span><strong>예약 목록 보기</strong><em>{won(total)}원</em><ArrowRight size={16}/></button>}
    {toast && <div className="mobile-toast"><Check size={16}/>{toast}</div>}

    {checkout && <div className="mobile-modal-backdrop" onClick={() => setCheckout(false)}><section className="mobile-checkout" onClick={(event) => event.stopPropagation()}><div className="checkout-title"><div><span className="section-kicker">YOUR RESERVATION</span><h2>예약 목록</h2></div><button className="close-button" onClick={() => setCheckout(false)} aria-label="닫기"><X size={20}/></button></div>
      <div className="mobile-cart-items">{cartItems.map((product) => <div className="mobile-cart-item" key={product.id}><span className="cart-produce">{product.image.startsWith("http") ? <img src={product.image} alt=""/> : product.image}</span><div className="cart-item-copy"><b>{product.name}</b><small>{product.variety} · {won(product.price)}원</small></div><div className="mobile-quantity"><button onClick={() => changeQuantity(product.id, -1)} aria-label="수량 줄이기"><Minus size={15}/></button><span>{cart[product.id]}</span><button onClick={() => changeQuantity(product.id, 1)} aria-label="수량 늘리기"><Plus size={15}/></button></div></div>)}</div>
      <div className="refund-options"><h3>상품이 부족하면 어떻게 할까요?</h3><button className={refund === "partial" ? "refund-selected" : ""} onClick={() => setRefund("partial")}><span className="radio-mark"/><span><b>가능한 상품만 받을게요</b><small>부족한 수량만 환불돼요.</small></span></button><button className={refund === "all" ? "refund-selected" : ""} onClick={() => setRefund("all")}><span className="radio-mark"/><span><b>전체 환불받을게요</b><small>일부라도 준비되지 않으면 전체 환불돼요.</small></span></button></div>
      <div className="mobile-bank-form"><h3>환불 계좌와 입금자 정보</h3><div className="bank-input-grid"><input placeholder="은행명" aria-label="은행명" value={refundBank} onChange={(e) => setRefundBank(e.target.value)}/><input placeholder="계좌번호" aria-label="환불 계좌번호" value={refundAccount} onChange={(e) => setRefundAccount(e.target.value)}/><input placeholder="예금주" aria-label="예금주" value={refundHolder} onChange={(e) => setRefundHolder(e.target.value)}/><input placeholder="입금자명" aria-label="입금자명" value={depositorName} onChange={(e) => setDepositorName(e.target.value)}/></div><p>주문 후 1시간 안에 입금해 주세요. 픽업은 {pickup} 당일이에요.</p></div>
      <div className="mobile-total"><span>결제 예정 금액</span><b>{won(total)}원</b></div><button className="place-order-button" disabled={submitting} onClick={() => void placeOrder()}>{submitting ? "예약 접수 중…" : "예약하고 입금 안내 받기"}<ArrowRight size={17}/></button>
    </section></div>}
  </main>;
}
