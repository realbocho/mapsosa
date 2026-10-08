"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, Clock3, Heart, MapPin, Menu, Minus, Plus, Search, ShoppingBag, Sparkles, Sprout, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { products, won, type Product } from "@/lib/products";

type Category = "전체" | "과일" | "채소" | "제철 추천";

export default function Home() {
  const [pickup, setPickup] = useState<"수요일" | "토요일">("수요일");
  const [category, setCategory] = useState<Category>("전체");
  const [catalog, setCatalog] = useState<Product[]>(products);
  const [catalogIsLive, setCatalogIsLive] = useState(false);
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<Product | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [refund, setRefund] = useState<"all" | "partial">("partial");
  const [refundBank, setRefundBank] = useState("");
  const [refundAccount, setRefundAccount] = useState("");
  const [refundHolder, setRefundHolder] = useState("");
  const [depositorName, setDepositorName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [cartHydrated, setCartHydrated] = useState(false);
  const [toast, setToast] = useState("");
  const [liked, setLiked] = useState<string[]>([]);
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("mapsosa-cart-v1");
      if (saved) setCart(JSON.parse(saved) as Record<string, number>);
    } catch { window.localStorage.removeItem("mapsosa-cart-v1"); }
    setCartHydrated(true);
  }, []);
  useEffect(() => {
    if (cartHydrated) window.localStorage.setItem("mapsosa-cart-v1", JSON.stringify(cart));
  }, [cart, cartHydrated]);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    if (!supabase) return;
    void supabase.from("products").select("id,name,specification,consumer_price,type,slot_size,description,image_url,stores(name,area,closed_weekdays),price_comparisons(price)").eq("active", true).then(({ data }) => {
      if (!active || !data) return;
      const dayIndex = pickup === "수요일" ? 3 : 6;
      const nextCatalog: Product[] = data.flatMap((row) => {
        const store = (Array.isArray(row.stores) ? row.stores[0] : row.stores) as { name?: string; area?: string; closed_weekdays?: number[] } | null;
        if (!store || store.closed_weekdays?.includes(dayIndex)) return [];
        const compares = (row.price_comparisons ?? []) as { price: number }[];
        const oldPrice = compares.length ? Math.max(...compares.map((entry) => entry.price)) : row.consumer_price;
        const fruit = /사과|배|포도|키위|딸기|귤|한라봉|복숭아|수박/.test(row.name);
        return [{ id: row.id, name: row.name, variety: row.specification, store: store.name ?? "동네 청과점", area: store.area ?? "마포구", price: row.consumer_price, oldPrice, unit: row.specification, type: row.type, slotSize: row.slot_size ?? undefined, applied: 0, image: fruit ? (/사과/.test(row.name) ? "🍎" : /포도/.test(row.name) ? "🍇" : /딸기/.test(row.name) ? "🍓" : "🍊") : "🥬", note: row.description || "동네 청과점에서 정성껏 준비했어요", tag: row.type === "slot" ? "함께 주문" : "바로 주문", pickup }];
      });
      setCatalog(nextCatalog);
      setCatalogIsLive(true);
    });
    return () => { active = false; };
  }, [pickup]);

  const visibleProducts = useMemo(() => catalog.filter((p) => p.pickup === pickup && (category === "전체" || category === "제철 추천" ? category !== "제철 추천" || p.tag.includes("제철") || p.tag.includes("인기") : category === "과일") && p.name.includes(query.trim())), [catalog, pickup, category, query]);
  const cartItems = catalog.filter((p) => cart[p.id]);
  const total = cartItems.reduce((sum, p) => sum + p.price * cart[p.id], 0);
  const count = Object.values(cart).reduce((sum, n) => sum + n, 0);

  function notify(text: string) { setToast(text); window.setTimeout(() => setToast(""), 2600); }
  function add(product: Product, amount = 1) {
    setCart((current) => ({ ...current, [product.id]: Math.max(0, (current[product.id] ?? 0) + amount) }));
    setSelected(null);
    notify(`${product.name}을(를) 장바구니에 담았어요`);
  }
  async function signIn() {
    const supabase = createClient();
    if (!supabase) { notify("Supabase 환경 변수를 설정하면 카카오 로그인을 사용할 수 있어요"); return; }
    const { error } = await supabase.auth.signInWithOAuth({ provider: "kakao", options: { redirectTo: `${window.location.origin}/auth/callback` } });
    if (error) notify(error.message);
  }
  async function placeOrder() {
    if (!refundBank.trim() || !refundAccount.trim() || !refundHolder.trim() || !depositorName.trim()) { notify("환불 계좌와 입금자 정보를 입력해주세요"); return; }
    if (!catalogIsLive) { notify("DB에 상품을 등록한 뒤 실제 주문을 접수할 수 있어요"); return; }
    const supabase = createClient();
    if (!supabase) { notify("Supabase 환경 변수를 설정하면 주문을 저장할 수 있어요"); return; }
    setSubmitting(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) { setSubmitting(false); await signIn(); return; }
      const pickupDate = new Date();
      const targetDay = pickup === "수요일" ? 3 : 6;
      let delta = (targetDay - pickupDate.getDay() + 7) % 7;
      if (delta === 0) delta = 7;
      pickupDate.setDate(pickupDate.getDate() + delta);
      const roundDate = `${pickupDate.getFullYear()}-${String(pickupDate.getMonth() + 1).padStart(2, "0")}-${String(pickupDate.getDate()).padStart(2, "0")}`;
      const { data: round, error: roundError } = await supabase.from("pickup_rounds").select("id").eq("pickup_date", roundDate).maybeSingle();
      if (roundError || !round) { notify("선택한 픽업 회차가 아직 열리지 않았어요"); return; }
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
      setCart({});
      setCheckout(false);
      notify(`주문 ${result?.order_number ?? "접수"} · 1시간 안에 입금해주세요`);
    } finally { setSubmitting(false); }
  }

  return <main>
    <div className="announcement"><span className="announcement-dot"/>이번 주 수요일 픽업 주문이 열렸어요 <span className="announcement-link">마감까지 18시간 <ArrowUpRight size={13}/></span></div>
    <header className="site-header">
      <button className="mobile-menu icon-button" aria-label="메뉴" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={21}/></button>
      <a className="brand" href="#top"><span className="brand-mark"><Sprout size={21} strokeWidth={2.4}/></span><span>맵소사<span className="brand-period">.</span></span></a>
      <nav className={mobileMenu ? "nav nav-open" : "nav"}>
        <a className="nav-active" href="#market">오늘의 장보기</a><a href="#how">이용방법</a><a href="#market">제철 이야기</a>
      </nav>
      <div className="header-actions"><button className="login-button" onClick={signIn}>카카오 로그인</button><button className="bag-button" aria-label="장바구니" onClick={() => setCheckout(true)}><ShoppingBag size={18}/><span>장바구니</span>{count > 0 && <b>{count}</b>}</button></div>
    </header>

    <section className="hero" id="top">
      <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/>GOOD FRUIT, GOOD NEIGHBORHOOD</div><h1>우리 동네 과일,<br/><em>함께 사면</em> 더 좋아요.</h1><p>동네 청과점의 신선한 과일을 모아<br className="desktop-only"/> 좋은 가격으로, 정해진 날에 만나요.</p><a href="#market" className="hero-cta">이번 주 과일 구경하기 <ArrowDown size={16}/></a><div className="hero-meta"><div className="avatar-stack"><span>🍊</span><span>🍎</span><span>🍇</span></div><span>이웃 <strong>1,284명</strong>이 함께하고 있어요</span></div></div>
      <div className="hero-art" aria-label="제철 과일 바구니"><div className="sun-disc"/><div className="art-caption">FRESH FROM<br/>YOUR NEIGHBORHOOD</div><div className="fruit-orbit fruit-orbit-one">🍊</div><div className="fruit-orbit fruit-orbit-two">🍎</div><div className="fruit-orbit fruit-orbit-three">🍇</div><div className="fruit-orbit fruit-orbit-four">🍋</div><div className="produce-card"><span className="card-leaf">✳</span><span className="produce-label">THIS WEEK’S PICK</span><strong>햇사과<br/>부사 2kg</strong><span className="produce-price">12,900원 <del>15,900원</del></span><span className="card-scribble">seasonal<br/>& local ♡</span></div><div className="art-bottom-note">GROWN WITH CARE · PICKED WITH YOU</div></div>
      <div className="hero-index">01 <span/> 03</div>
    </section>

    <section className="trust-strip" id="how"><div><span className="trust-icon"><Sprout size={17}/></span><span><b>동네 청과점</b>에서 직접 준비해요</span></div><i/><div><span className="trust-icon trust-orange"><ArrowDown size={17}/></span><span><b>중개 수수료 포함</b> 가격을 미리 확인해요</span></div><i/><div><span className="trust-icon trust-yellow"><Clock3 size={17}/></span><span><b>수·토 픽업</b>으로 여유롭게 찾아가요</span></div></section>

    <section className="market-section" id="market"><div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>WEEKLY MARKET</div><h2>이번 주, <em>잘 익은</em> 것들</h2><p>청과점 사장님이 직접 고른 오늘의 과일과 채소</p></div><a className="text-link" href="#market">전체 상품 보기 <ArrowRight size={16}/></a></div>
      <div className="market-controls"><div className="pickup-switch" aria-label="픽업일 선택">{(["수요일", "토요일"] as const).map((day) => <button key={day} className={pickup === day ? "pickup-active" : ""} onClick={() => setPickup(day)}>{day === "수요일" ? "수요일 픽업" : "토요일 픽업"}{pickup === day && <span className="switch-live">진행 중</span>}</button>)}</div><div className="filter-side"><div className="category-tabs">{(["전체", "과일", "채소", "제철 추천"] as Category[]).map((item) => <button key={item} className={category === item ? "category-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div><label className="search-box"><Search size={16}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="과일 검색"/><button aria-label="검색" onClick={() => {}}><ChevronDown size={14}/></button></label></div></div>
      <div className="market-caption"><span><MapPin size={14}/> 서울 마포구 <ChevronDown size={13}/></span><span>픽업 마감 <b>{pickup === "수요일" ? "화요일 오전 10시" : "금요일 오전 10시"}</b></span></div>
      <div className="product-grid">{visibleProducts.map((p, index) => <article className="product-card" key={p.id} style={{ animationDelay: `${index * 70}ms` }}><div className={`product-visual visual-${p.id}`} role="button" tabIndex={0} onClick={() => setSelected(p)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(p); } }} aria-label={`${p.name} 상세 보기`}><span className="product-emoji">{p.image}</span><span className="product-sticker">{p.tag}</span><button className={liked.includes(p.id) ? "heart-button heart-liked" : "heart-button"} aria-label="관심 상품" onClick={(event) => { event.stopPropagation(); setLiked((v) => v.includes(p.id) ? v.filter((id) => id !== p.id) : [...v, p.id]); }}><Heart size={17} fill={liked.includes(p.id) ? "currentColor" : "none"}/></button><span className="image-small-label">LOCAL<br/>PICK</span></div><div className="product-info"><div className="store-label"><MapPin size={12}/>{p.area} · {p.store}</div><div className="product-title-row"><h3>{p.name}</h3><span className={p.type === "slot" ? "type-badge slot-badge" : "type-badge instant-badge"}>{p.type === "slot" ? "슬롯형" : "즉시구매"}</span></div><div className="product-variety">{p.variety}</div>{p.type === "slot" ? <div className="slot-progress"><div className="slot-progress-top"><span>함께 모으는 중</span><b>{p.applied}<small>/{p.slotSize}개 단위</small></b></div><div className="progress-track"><span style={{ width: `${Math.min(100, (p.applied % (p.slotSize ?? 1)) / (p.slotSize ?? 1) * 100 || 100)}%` }}/></div><div className="slot-note">{Math.floor(p.applied / (p.slotSize ?? 1))}세트 확정 · 다음 세트까지 {((p.slotSize ?? 1) - p.applied % (p.slotSize ?? 1)) || (p.slotSize ?? 1)}개</div></div> : <div className="instant-note"><span className="instant-check"><Check size={12}/></span>입금 확인 후 바로 주문 확정</div>}<div className="price-row"><div><strong>{won(p.price)}<small>원</small></strong><del>{won(p.oldPrice)}원</del></div><button className="add-button" aria-label={`${p.name} 담기`} onClick={() => add(p)}><Plus size={19}/></button></div></div></article>)}</div>
      {visibleProducts.length === 0 && <div className="empty-state"><span>🍐</span><b>아직 이 픽업일에 등록된 상품이 없어요</b><p>다른 픽업일이나 검색어를 확인해 주세요.</p></div>}
      <div className="market-footer"><span><Sparkles size={16}/> 매주 월·목, 새로운 상품이 올라와요</span><button onClick={() => notify("새 상품 알림은 카카오 로그인 후 신청할 수 있어요")}>새 상품 알림 받기 <ArrowRight size={15}/></button></div>
    </section>

    <section className="pickup-banner"><div className="banner-copy"><span className="banner-overline">A LITTLE NOTE FOR YOUR PICKUP</span><h2>잘 고른 과일은<br/>직접 만나러 와주세요.</h2><p>수요일과 토요일, 동네 청과점에서 픽업해요.<br/>오늘 찾아가지 않은 상품은 환불이 어려워요.</p><a href="#market">픽업 안내 자세히 보기 <ArrowUpRight size={15}/></a></div><div className="banner-art"><div className="banner-sun"/><span className="banner-fruit fruit-a">🍐</span><span className="banner-fruit fruit-b">🍊</span><span className="banner-fruit fruit-c">🍋</span><div className="banner-paper"><span>WED</span><b>09</b><span>OCTOBER<br/>PICK-UP DAY</span></div><span className="banner-flower">✿</span></div></section>

    <footer className="footer"><div className="footer-brand"><a className="brand" href="#top"><span className="brand-mark"><Sprout size={20}/></span><span>맵소사<span className="brand-period">.</span></span></a><p>동네 과일의 새로운 장보기</p></div><div className="footer-links"><a href="#how">서비스 소개</a><a href="#how">이용약관</a><a href="#how">개인정보처리방침</a><a href="mailto:hello@mapsosa.kr">문의하기</a></div><small>© 2026 MAPSOSA. 함께 사는 즐거움.</small></footer>

    {count > 0 && <button className="floating-cart" onClick={() => setCheckout(true)}><span className="float-icon"><ShoppingBag size={18}/><b>{count}</b></span><span>장바구니 보기</span><strong>{won(total)}원</strong><ArrowRight size={17}/></button>}
    {toast && <div className="toast"><Check size={16}/>{toast}</div>}

    {selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><section className="product-modal" onClick={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setSelected(null)}><X size={20}/></button><div className={`modal-visual visual-${selected.id}`}><span>{selected.image}</span></div><div className="modal-content"><div className="eyebrow"><span className="eyebrow-line"/>{selected.area} · {selected.store}</div><h2>{selected.name}</h2><p className="modal-variety">{selected.variety} · {selected.note}</p><div className="compare-box"><div><span>맵소사 가격</span><b>{won(selected.price)}원</b></div><div><span>비교 가격 <small>(동일 규격)</small></span><b>{won(selected.oldPrice)}원</b></div><div className="compare-saving"><span>맵소사에서</span><b>{won(selected.oldPrice - selected.price)}원 절약 <ArrowDown size={14}/></b></div></div>{selected.type === "slot" ? <div className="modal-policy"><b>슬롯 {selected.slotSize}개 단위로 진행해요</b><p>마감까지 한 세트도 모이지 않으면 전액 환불돼요. 마지막에 남는 수량은 주문 전 선택한 환불 방식에 따라 처리돼요.</p></div> : <div className="modal-policy instant-policy"><b>바로 주문할 수 있어요</b><p>입금 확인 후 청과점 물량 확인 단계로 넘어가요.</p></div>}<button className="modal-add" onClick={() => add(selected)}><ShoppingBag size={17}/> 장바구니 담기 · {won(selected.price)}원</button></div></section></div>}

    {checkout && <div className="modal-backdrop" onClick={() => setCheckout(false)}><section className="checkout-modal" onClick={(e) => e.stopPropagation()}><div className="checkout-head"><div><span className="eyebrow"><span className="eyebrow-line"/>YOUR BASKET</span><h2>장바구니</h2></div><button className="modal-close" onClick={() => setCheckout(false)}><X size={20}/></button></div>{cartItems.length === 0 ? <div className="empty-cart"><ShoppingBag size={28}/><b>장바구니가 비어 있어요</b><button onClick={() => setCheckout(false)}>상품 둘러보기</button></div> : <><div className="cart-items">{cartItems.map((p) => <div className="cart-item" key={p.id}><span className="cart-emoji">{p.image}</span><div className="cart-desc"><b>{p.name}</b><small>{p.variety} · {won(p.price)}원</small></div><div className="quantity"><button onClick={() => setCart((c) => ({ ...c, [p.id]: Math.max(0, c[p.id] - 1) }))}><Minus size={14}/></button><span>{cart[p.id]}</span><button onClick={() => setCart((c) => ({ ...c, [p.id]: c[p.id] + 1 }))}><Plus size={14}/></button></div></div>)}</div><div className="checkout-details"><h3>부족한 상품이 생기면 어떻게 할까요?</h3><button className={refund === "partial" ? "refund-choice choice-selected" : "refund-choice"} onClick={() => setRefund("partial")}><span className="radio-dot"/><span><b>가능한 상품만 받을게요</b><small>부족한 수량만 환불돼요. 다시 확인하지 않아요.</small></span></button><button className={refund === "all" ? "refund-choice choice-selected" : "refund-choice"} onClick={() => setRefund("all")}><span className="radio-dot"/><span><b>전체 환불받을게요</b><small>일부라도 준비되지 않으면 주문 전체를 환불해요.</small></span></button><div className="pickup-reminder"><Clock3 size={16}/><span>주문 후 1시간 안에 입금해 주세요. 픽업은 {pickup} 당일이에요.</span></div><h3 className="bank-form-title">환불받을 계좌와 입금자 정보를 입력해 주세요</h3><div className="bank-form"><input aria-label="은행명" placeholder="은행명" value={refundBank} onChange={(e) => setRefundBank(e.target.value)}/><input aria-label="환불 계좌번호" placeholder="환불 계좌번호" value={refundAccount} onChange={(e) => setRefundAccount(e.target.value)}/><input aria-label="예금주" placeholder="예금주" value={refundHolder} onChange={(e) => setRefundHolder(e.target.value)}/><input aria-label="입금자명" placeholder="입금자명" value={depositorName} onChange={(e) => setDepositorName(e.target.value)}/></div><p className="bank-note">계좌이체 주문은 접수 후 1시간 안에 입금해야 해요. 입금 계좌 안내는 주문 접수 후 표시됩니다.</p></div><div className="checkout-total"><span>결제 예정 금액 <small>상품 가격에 중개 수수료 포함</small></span><b>{won(total)}원</b></div><button className="checkout-submit" disabled={submitting} onClick={() => void placeOrder()}>{submitting ? "주문을 접수하고 있어요…" : "카카오 로그인하고 주문하기"} <ArrowRight size={17}/></button><p className="checkout-terms">주문 시 <u>주문 및 환불 안내</u>에 동의한 것으로 봅니다.</p></>}</section></div>}
  </main>;
}
