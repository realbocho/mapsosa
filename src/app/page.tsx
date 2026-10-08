"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, Check, Clock3, MapPin, Minus, Plus, ShoppingBag, Sprout, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isProductImageUrl, won, type Product } from "@/lib/products";
import { StoreMap, type StoreLocation } from "@/components/store-map";
import { ProductImage } from "@/components/product-image";
import { LegalLinks } from "@/components/legal-links";
import { formatPickupDate, nextPickupDate, orderDeadlineTimestamp, type PickupDay } from "@/lib/pickup-dates";
import { AcquisitionSurvey } from "@/components/acquisition-survey";
import { AnalyticsConsent } from "@/components/analytics-consent";
import { newestOrderUpdate, orderUpdatesSeenKey } from "@/lib/order-notifications";

export default function Home() {
  const pickupOptions = useMemo(() => (["수요일", "토요일"] as PickupDay[])
    .map((day) => ({ day, date: nextPickupDate(day) }))
    .sort((a, b) => a.date.localeCompare(b.date)), []);
  const [pickup, setPickup] = useState<PickupDay>(() => pickupOptions[0].day);
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [checkout, setCheckout] = useState(false);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
  const [refund, setRefund] = useState<"all" | "partial">("partial");
  const [refundBank, setRefundBank] = useState("");
  const [refundAccount, setRefundAccount] = useState("");
  const [refundHolder, setRefundHolder] = useState("");
  const [depositorName, setDepositorName] = useState("");
  const [orderDetailsSaved, setOrderDetailsSaved] = useState(false);
  const [savingOrderDetails, setSavingOrderDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [authStatus, setAuthStatus] = useState<"checking" | "signed_in" | "signed_out">("checking");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [hasOrderUpdates, setHasOrderUpdates] = useState(false);
  const [showGuidePrompt, setShowGuidePrompt] = useState(false);
  const [analyticsConsent, setAnalyticsConsent] = useState(false);
  const [paymentAccount, setPaymentAccount] = useState<{ bank_name: string; account_number: string; account_holder: string; memo: string } | null>(null);
  const pickupDate = pickupOptions.find((option) => option.day === pickup)?.date ?? nextPickupDate(pickup);
  const soonestDate = formatPickupDate(pickupDate);
  const deadlineRemaining = currentTime ? orderDeadlineTimestamp(pickupDate) - currentTime : null;
  const deadlineCountdown = deadlineRemaining === null ? "시간 확인 중…" : deadlineRemaining <= 0 ? "마감됐어요" : (() => {
    const totalSeconds = Math.floor(deadlineRemaining / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
    return days ? `${days}일 ${clock}` : clock;
  })();

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("mapsosa-cart-v1");
      if (saved) setCart(JSON.parse(saved) as Record<string, number>);
    } catch { window.localStorage.removeItem("mapsosa-cart-v1"); }
  }, []);
  useEffect(() => { window.localStorage.setItem("mapsosa-cart-v1", JSON.stringify(cart)); }, [cart]);
  useEffect(() => {
    if (window.localStorage.getItem("mapsosa-guide-prompt-dismissed-v1") !== "1") setShowGuidePrompt(true);
  }, []);
  useEffect(() => {
    setCurrentTime(Date.now());
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
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
    const client = supabase;
    void supabase.from("payment_settings").select("bank_name,account_number,account_holder,memo").eq("singleton", true).maybeSingle().then(({ data }) => { if (data) setPaymentAccount(data); });
    let active = true;
    async function syncUser(userId: string | null) {
      setCurrentUserId(userId);
      setAuthStatus(userId ? "signed_in" : "signed_out");
      if (!userId) { setAnalyticsConsent(false); return; }
      const { data: profile } = await client.from("profiles").select("analytics_consent").eq("id", userId).maybeSingle();
      if (active) setAnalyticsConsent(Boolean(profile?.analytics_consent));
    }
    void supabase.auth.getUser().then(({ data }) => { if (active) void syncUser(data.user?.id ?? null); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { void syncUser(session?.user?.id ?? null); });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!currentUserId) { setHasOrderUpdates(false); return; }
    const supabase = createClient();
    if (!supabase) return;
    const storageKey = orderUpdatesSeenKey(currentUserId);
    let active = true;
    let checking = false;
    async function checkForOrderUpdates() {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      const { data } = await supabase!.from("orders").select("updated_at").eq("user_id", currentUserId).order("updated_at", { ascending: false }).limit(1);
      if (active) {
        const newest = newestOrderUpdate(data ?? []);
        const lastSeen = window.localStorage.getItem(storageKey);
        if (!lastSeen) {
          window.localStorage.setItem(storageKey, newest || "0");
          setHasOrderUpdates(false);
        } else setHasOrderUpdates(Boolean(newest && newest > lastSeen));
      }
      checking = false;
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) void checkForOrderUpdates();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void checkForOrderUpdates(); };
    void checkForOrderUpdates();
    const timer = window.setInterval(() => void checkForOrderUpdates(), 15000);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [currentUserId]);
  useEffect(() => {
    if (!currentUserId) { setRefundBank(""); setRefundAccount(""); setRefundHolder(""); setDepositorName(""); setOrderDetailsSaved(false); return; }
    setRefundBank(""); setRefundAccount(""); setRefundHolder(""); setDepositorName(""); setOrderDetailsSaved(false);
    const supabase = createClient();
    if (!supabase) return;
    let active = true;
    void supabase.from("customer_order_details").select("refund_bank,refund_account,refund_account_holder,depositor_name").eq("user_id", currentUserId).maybeSingle().then(({ data }) => {
      if (!active || !data) return;
      setRefundBank(data.refund_bank);
      setRefundAccount(data.refund_account);
      setRefundHolder(data.refund_account_holder);
      setDepositorName(data.depositor_name);
      setOrderDetailsSaved(true);
    });
    return () => { active = false; };
  }, [currentUserId]);
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    if (!supabase) { setLoading(false); return; }
    void supabase.from("stores").select("id,name,area,address").eq("active", true).order("name").then(({ data }) => {
      if (active && data) setStores(data as StoreLocation[]);
    });
    setLoading(true);
    const productsRequest = supabase.from("products").select("id,name,specification,consumer_price,type,slot_size,description,image_url,stores(id,name,area,closed_weekdays),price_comparisons(price)").eq("active", true);
    const totalsRequest = supabase.rpc("product_order_totals", { p_pickup_date: pickupDate });
    void Promise.all([productsRequest, totalsRequest]).then(([{ data }, { data: orderTotals }]) => {
      if (!active) return;
      if (data) {
        const quantities = new Map<string, number>((orderTotals ?? []).map((entry: { product_id: string; applied_quantity: number }) => [entry.product_id, Number(entry.applied_quantity)] as const));
        const dayIndex = pickup === "수요일" ? 3 : 6;
        setCatalog(data.flatMap((row) => {
          const store = (Array.isArray(row.stores) ? row.stores[0] : row.stores) as { id?: string; name?: string; area?: string; closed_weekdays?: number[] } | null;
          if (!store || store.closed_weekdays?.includes(dayIndex)) return [];
          const comparisons = (row.price_comparisons ?? []) as { price: number }[];
          const comparisonPrice = comparisons.length ? Math.max(...comparisons.map((entry) => entry.price)) : row.consumer_price;
          const isFruit = /사과|배|포도|키위|딸기|귤|한라봉|복숭아|수박|참외/.test(row.name);
          const emoji = /사과/.test(row.name) ? "🍎" : /포도/.test(row.name) ? "🍇" : /딸기/.test(row.name) ? "🍓" : /배/.test(row.name) ? "🍐" : isFruit ? "🍊" : "🥬";
          return [{ id: row.id, storeId: store.id, name: row.name, variety: row.specification, store: store.name ?? "동네 청과점", area: store.area ?? "우리 동네", price: row.consumer_price, oldPrice: comparisonPrice, unit: row.specification, type: row.type, slotSize: row.slot_size ?? undefined, applied: quantities.get(row.id) ?? 0, image: row.image_url || emoji, note: row.description || "동네 청과점에서 정성껏 준비했어요", tag: row.type === "slot" ? "공동구매" : "바로 구매", pickup }];
        }));
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, [pickup, pickupDate]);

  const count = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  function dismissGuidePrompt() {
    window.localStorage.setItem("mapsosa-guide-prompt-dismissed-v1", "1");
    setShowGuidePrompt(false);
  }
  const cartItems = catalog.filter((product) => cart[product.id]);
  const total = cartItems.reduce((sum, product) => sum + product.price * cart[product.id], 0);
  const storeCatalog = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; area: string; products: Product[] }>();
    for (const product of catalog) {
      const id = product.storeId ?? product.store;
      const group = groups.get(id) ?? { id, name: product.store, area: product.area, products: [] };
      group.products.push(product);
      groups.set(id, group);
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [catalog]);
  const pickupStores = useMemo(() => {
    const pickupStoreIds = new Set(storeCatalog.map((store) => store.id));
    return stores.filter((store) => pickupStoreIds.has(store.id));
  }, [storeCatalog, stores]);
  const [openStoreId, setOpenStoreId] = useState<string | null>(null);
  const selectedPickupStore = pickupStores.find((store) => store.id === openStoreId) ?? null;
  function notify(message: string) { setToast(message); window.setTimeout(() => setToast(""), 2600); }
  function track(eventName: "store_detail_opened" | "add_to_cart" | "checkout_started", details: { store_id?: string; product_id?: string } = {}) {
    if (!currentUserId || !analyticsConsent) return;
    const supabase = createClient();
    if (supabase) void supabase.from("analytics_events").insert({ user_id: currentUserId, event_name: eventName, ...details });
  }
  async function saveOrderDetails() {
    if (!currentUserId) { notify("저장하려면 먼저 카카오 로그인을 해주세요"); return; }
    if (!refundBank.trim() || !refundAccount.trim() || !refundHolder.trim() || !depositorName.trim()) { notify("환불 계좌와 입금자 정보를 모두 입력해 주세요"); return; }
    const supabase = createClient();
    if (!supabase) return;
    setSavingOrderDetails(true);
    const { error } = await supabase.from("customer_order_details").upsert({
      user_id: currentUserId, refund_bank: refundBank.trim(), refund_account: refundAccount.trim(),
      refund_account_holder: refundHolder.trim(), depositor_name: depositorName.trim(), updated_at: new Date().toISOString(),
    });
    setSavingOrderDetails(false);
    if (error) { notify("정보를 저장하지 못했어요. 잠시 후 다시 시도해 주세요."); return; }
    setOrderDetailsSaved(true);
    notify("주문 정보를 저장했어요. 다음 주문에 자동으로 입력됩니다.");
  }
  async function removeSavedOrderDetails() {
    if (!currentUserId) return;
    const supabase = createClient();
    if (!supabase) return;
    setSavingOrderDetails(true);
    const { error } = await supabase.from("customer_order_details").delete().eq("user_id", currentUserId);
    setSavingOrderDetails(false);
    if (error) { notify("저장된 정보를 삭제하지 못했어요. 다시 시도해 주세요."); return; }
    setOrderDetailsSaved(false);
    notify("저장된 주문 정보를 삭제했어요.");
  }
  function changeQuantity(id: string, amount: number) {
    if (amount > 0) {
      const product = catalog.find((item) => item.id === id);
      track("add_to_cart", { product_id: id, ...(product?.storeId ? { store_id: product.storeId } : {}) });
    }
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
    const supabase = createClient();
    if (!supabase) { notify("Supabase 설정 후 주문할 수 있어요"); return; }
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setAuthStatus("signed_out");
      setShowLoginPrompt(true);
      return;
    }
    if (!refundBank.trim() || !refundAccount.trim() || !refundHolder.trim() || !depositorName.trim()) { notify("환불 계좌와 입금자 정보를 입력해 주세요"); return; }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("create_order", {
        p_pickup_date: pickupDate,
        p_refund_preference: refund === "partial" ? "partial" : "all_or_nothing",
        p_refund_bank: refundBank,
        p_refund_account: refundAccount,
        p_refund_account_holder: refundHolder,
        p_depositor_name: depositorName,
        p_items: cartItems.map((item) => ({ product_id: item.id, quantity: cart[item.id] })),
      });
      if (error) { notify(error.message); return; }
      setCart({}); setCheckout(false);
      window.location.assign("/orders");
    } finally { setSubmitting(false); }
  }

  return <main className="mobile-app">
    <header className="mobile-header">
      <div className="mobile-header-brand-group"><a className="mobile-brand" href="/" aria-label="맵소사 홈"><span className="mobile-brand-mark"><Sprout size={18}/></span>맵소사</a><a className="header-guide-link" href="/guide" onClick={dismissGuidePrompt}>이용방법 보기</a></div>
      <div className="mobile-header-actions"><a className={`admin-link${hasOrderUpdates ? " has-updates" : ""}`} href="/orders" aria-label={hasOrderUpdates ? "내 주문, 새 변경사항 있음" : "내 주문"}>내 주문</a><a className="admin-link" href="/admin">관리자</a><button className="header-cart" onClick={() => { track("checkout_started"); setCheckout(true); }} aria-label={`장바구니 ${count}개`}><ShoppingBag size={19}/>{count > 0 && <span>{count}</span>}</button></div>
    </header>

    <div className="mobile-content">
      {showGuidePrompt && <aside className="guide-invite" aria-label="처음 방문 안내"><span className="guide-invite-mark">처음 오셨나요?</span><div><b>주문부터 픽업까지 한눈에</b><small>맵소사 이용 방법과 환불·픽업 흐름을 확인해 보세요.</small></div><a href="/guide" onClick={dismissGuidePrompt}>안내 보기 <ArrowRight size={14}/></a><button onClick={dismissGuidePrompt} aria-label="이용안내 제안 닫기">나중에</button></aside>}

      <section className="pickup-panel" aria-label="픽업일 선택">
        <div><b>어느 날 픽업할까요?</b><span>픽업 날짜를 선택해 주세요</span></div>
        <div className="day-picker">{pickupOptions.map(({ day, date }) => <button key={day} className={pickup === day ? "day-selected" : ""} onClick={() => { setPickup(day); setOpenStoreId(null); }}><b>{day}</b><small>{formatPickupDate(date)}</small></button>)}</div>
        <div className={`pickup-deadline-countdown${deadlineRemaining !== null && deadlineRemaining <= 0 ? " is-closed" : ""}`} role="timer" aria-label={deadlineRemaining !== null && deadlineRemaining <= 0 ? "선택한 픽업일 주문이 마감되었습니다" : `주문 마감까지 ${deadlineCountdown}`}>
          <span>{deadlineRemaining !== null && deadlineRemaining <= 0 ? "선택한 픽업일 주문" : "주문 마감까지"}</span><b>{deadlineCountdown}</b><small>픽업 전날 오전 10시 마감</small>
        </div>
      </section>

      <section className="mobile-market map-market">
        <StoreMap variant="background" stores={pickupStores} apiKey={process.env.NEXT_PUBLIC_KAKAO_MAP_KEY} selectedStoreId={openStoreId} onStoreSelect={setOpenStoreId}/>
        <div className="store-bottom-sheet">
          <div className="store-sheet-handle" aria-hidden="true"><span/></div>
          <div className="mobile-section-heading"><div><span className="section-kicker">{pickup.toUpperCase()}</span><h2>{pickup} 가게</h2></div><span className="date-chip"><Clock3 size={13}/>{soonestDate}</span></div>
          {selectedPickupStore && <div className="store-map-selected sheet-selected-store"><div><b>{selectedPickupStore.name}</b><span>{selectedPickupStore.address}</span></div><a href={`https://map.kakao.com/link/search/${encodeURIComponent(`${selectedPickupStore.name} ${selectedPickupStore.address}`)}`} target="_blank" rel="noreferrer">길찾기 <ArrowRight size={14}/></a></div>}
          {loading ? <div className="mobile-empty">가게와 과일을 불러오고 있어요…</div> : storeCatalog.length ? <div className="pickup-store-list">{storeCatalog.map((store) => {
          const isOpen = openStoreId === store.id;
          const preview = store.products.slice(0, 3);
          return <article className={`pickup-store-card${isOpen ? " is-open" : ""}`} key={store.id}>
            <button className="pickup-store-summary" aria-expanded={isOpen} onClick={() => { if (!isOpen) track("store_detail_opened", { store_id: store.id }); setOpenStoreId(isOpen ? null : store.id); }}>
              <span className="pickup-store-heading"><span><b>{store.name}</b><small><MapPin size={12}/>{store.area} · 과일 {store.products.length}종</small></span><span className="pickup-store-chevron">{isOpen ? "접기" : "자세히"}<ArrowRight size={15}/></span></span>
              <span className="fruit-preview">{preview.map((product) => <span className="fruit-preview-item" key={product.id}><span className="fruit-preview-image"><ProductImage image={product.image} fallback={product.image}/></span><span className="fruit-preview-copy"><b>{product.name}</b><small>{won(product.price)}원</small></span></span>)}{store.products.length > preview.length && <span className="fruit-preview-more">+{store.products.length - preview.length}</span>}</span>
              <span className="pickup-store-hint">과일을 눌러 상품과 예약 정보를 확인하세요</span>
            </button>
            {isOpen && <div className="store-product-details">{store.products.map((product) => {
              const imageIsUrl = isProductImageUrl(product.image);
              return <article className="mobile-product-card" key={product.id}>
                <div className="mobile-product-top"><span className="product-kind">{product.type === "slot" ? "슬롯형" : "즉시구매형"}</span><span className="product-status">모집 중</span><span className="product-deadline">픽업 {soonestDate}</span></div>
                <div className="mobile-product-body"><div className="mobile-product-main"><h3>{product.name} <span>{product.variety}</span></h3><strong>{won(product.price)}원</strong>{product.type === "slot" && product.slotSize && <><div className="mobile-progress"><span style={{ width: `${Math.min(100, product.applied / product.slotSize * 100)}%` }}/></div><p className="progress-caption"><b>{product.applied}개 예약 · {Math.floor(product.applied / product.slotSize)}세트 분량</b><span>· 다음 세트 {Math.max(0, product.slotSize - product.applied % product.slotSize)}개 남음</span></p></>}</div><div className="mobile-fruit" aria-hidden="true">{imageIsUrl ? <ProductImage image={product.image} fallback="🍎"/> : product.image}</div></div>
                <div className="mobile-product-bottom"><div className="mobile-store"><MapPin size={14}/><b>{product.store}</b><span>· {product.area}</span></div><button className="reserve-button" onClick={() => { changeQuantity(product.id, 1); notify(`${product.name}을(를) 담았어요`); }}>{cart[product.id] ? `${cart[product.id]}개 담김` : "예약하기"}<Plus size={15}/></button></div>
              </article>;
            })}</div>}
          </article>;
          })}</div> : <div className="mobile-empty"><span>🍐</span><b>{pickup} 픽업 가게가 아직 없어요</b><p>관리자가 가게와 과일을 등록하면 이곳에 보여요.</p><a href="/admin">관리자 상품 등록 <ArrowRight size={14}/></a></div>}
        </div>
      </section>

      <section className="mobile-start">{authStatus === "signed_in" ? <><div className="kakao-start kakao-authenticated" role="status">카카오 로그인 완료</div><button className="kakao-logout" onClick={() => void signOut()}>로그아웃</button></> : <button className="kakao-start" onClick={signIn} disabled={authStatus === "checking"}>{authStatus === "checking" ? "로그인 확인 중…" : "카카오로 시작하기"}</button>}<p>{authStatus === "signed_in" ? "로그인 상태로 예약을 진행할 수 있어요." : "처음 방문하셨나요? 카카오 계정으로 바로 가입할 수 있어요."}</p></section>
      {authStatus === "signed_in" && currentUserId && <AnalyticsConsent userId={currentUserId}/>}
      <footer className="mobile-footer"><LegalLinks/>© 2026 MAPSOSA · 동네에서 나눠 사는 즐거움</footer>
    </div>

    {count > 0 && <button className="mobile-floating-cart" onClick={() => setCheckout(true)}><span><ShoppingBag size={17}/><b>{count}</b></span><strong>예약 목록 보기</strong><em>{won(total)}원</em><ArrowRight size={16}/></button>}
    {toast && <div className="mobile-toast"><Check size={16}/>{toast}</div>}

    {authStatus === "signed_in" && currentUserId && <AcquisitionSurvey userId={currentUserId}/>}

    {showLoginPrompt && <div className="mobile-modal-backdrop login-required-backdrop" onClick={() => setShowLoginPrompt(false)}><section className="login-required-dialog" role="dialog" aria-modal="true" aria-labelledby="login-required-title" onClick={(event) => event.stopPropagation()}><button className="login-required-close" onClick={() => setShowLoginPrompt(false)} aria-label="닫기"><X size={19}/></button><span className="login-required-icon"><Sprout size={21}/></span><h2 id="login-required-title">로그인이 필요합니다</h2><p>주문하려면 카카오 계정으로 로그인해 주세요.</p><button className="kakao-start" onClick={() => void signIn()}>카카오로 로그인하기</button></section></div>}

    {checkout && <div className="mobile-modal-backdrop" onClick={() => setCheckout(false)}><section className="mobile-checkout" onClick={(event) => event.stopPropagation()}><div className="checkout-title"><div><span className="section-kicker">YOUR RESERVATION</span><h2>예약 목록</h2></div><button className="close-button" onClick={() => setCheckout(false)} aria-label="닫기"><X size={20}/></button></div>
      <div className="mobile-cart-items">{cartItems.map((product) => <div className="mobile-cart-item" key={product.id}><span className="cart-produce"><ProductImage image={product.image} fallback={product.image}/></span><div className="cart-item-copy"><b>{product.name}</b><small>{product.variety} · {won(product.price)}원</small></div><div className="mobile-quantity"><button onClick={() => changeQuantity(product.id, -1)} aria-label="수량 줄이기"><Minus size={15}/></button><span>{cart[product.id]}</span><button onClick={() => changeQuantity(product.id, 1)} aria-label="수량 늘리기"><Plus size={15}/></button></div></div>)}</div>
      <div className="refund-options"><h3>상품이 부족하면 어떻게 할까요?</h3><button className={refund === "partial" ? "refund-selected" : ""} onClick={() => setRefund("partial")}><span className="radio-mark"/><span><b>가능한 상품만 받을게요</b><small>부족한 수량만 환불돼요.</small></span></button><button className={refund === "all" ? "refund-selected" : ""} onClick={() => setRefund("all")}><span className="radio-mark"/><span><b>전체 환불받을게요</b><small>일부라도 준비되지 않으면 전체 환불돼요.</small></span></button></div>
      <div className="mobile-bank-form"><h3>입금 계좌 안내</h3>{paymentAccount ? <div className="checkout-transfer-account"><b>{paymentAccount.bank_name} {paymentAccount.account_number}</b><span>예금주 {paymentAccount.account_holder}</span><small>{paymentAccount.memo}</small></div> : <div className="checkout-transfer-account unavailable">입금 계좌가 아직 등록되지 않았어요. 관리자 설정 후 주문할 수 있어요.</div>}<h3>환불 계좌와 입금자 정보</h3><div className="bank-input-grid"><input placeholder="은행명" aria-label="환불 은행명" value={refundBank} onChange={(e) => setRefundBank(e.target.value)}/><input placeholder="계좌번호" aria-label="환불 계좌번호" value={refundAccount} onChange={(e) => setRefundAccount(e.target.value)}/><input placeholder="예금주" aria-label="예금주" value={refundHolder} onChange={(e) => setRefundHolder(e.target.value)}/><input placeholder="입금자명" aria-label="입금자명" value={depositorName} onChange={(e) => setDepositorName(e.target.value)}/></div><p>입금 후 관리자가 확인하면 주문 상태가 갱신됩니다. 픽업은 {soonestDate}이며, 주문은 픽업일 전날 오전 10시에 마감됩니다.</p></div>
      <div className="saved-order-details"><span>{orderDetailsSaved ? "저장된 정보가 다음 주문에 자동으로 입력돼요." : "다음 주문에 다시 쓰려면 정보를 저장해 주세요."}</span><div><button type="button" disabled={savingOrderDetails} onClick={() => void saveOrderDetails()}>{savingOrderDetails ? "저장 중…" : orderDetailsSaved ? "정보 업데이트" : "정보 저장"}</button>{orderDetailsSaved && <button type="button" className="saved-details-delete" disabled={savingOrderDetails} onClick={() => void removeSavedOrderDetails()}>저장 정보 삭제</button>}</div></div>
      <div className="mobile-total"><span>결제 예정 금액</span><b>{won(total)}원</b></div><button className="place-order-button" disabled={submitting || !paymentAccount} onClick={() => void placeOrder()}>{submitting ? "예약 접수 중…" : !paymentAccount ? "입금 계좌 설정 대기" : "예약하고 입금 안내 받기"}<ArrowRight size={17}/></button>
    </section></div>}
  </main>;
}
