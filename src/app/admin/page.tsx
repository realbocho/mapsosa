"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Check, Store } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { won } from "@/lib/products";
import { AdminOrders } from "@/components/admin-orders";

type StoreRow = { id: string; name: string; area: string; address: string; opening_time: string | null; closing_time: string; closed_weekdays: number[]; active: boolean };
type ComparisonRow = { id: string; vendor: string; price: number; specification: string };
type ProductRow = { id: string; store_id: string; name: string; specification: string; description: string | null; image_url: string | null; consumer_price: number; type: "slot" | "instant"; slot_size: number | null; available_quantity: number | null; active: boolean; stores: StoreRow | StoreRow[] | null; price_comparisons: ComparisonRow[] };
const PRODUCT_EMOJIS = ["🍎", "🍏", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🫐", "🍑", "🍒", "🥭", "🍍", "🥝", "🥑", "🥬", "🥕", "🍅", "🧅"] as const;

export default function AdminPage() {
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [items, setItems] = useState<ProductRow[]>([]);
  const [storeName, setStoreName] = useState("");
  const [storeArea, setStoreArea] = useState("");
  const [storeAddress, setStoreAddress] = useState("");
  const [storePhone, setStorePhone] = useState("");
  const [storeOpeningTime, setStoreOpeningTime] = useState("09:00");
  const [storeClosingTime, setStoreClosingTime] = useState("20:00");
  const [storeDaysOff, setStoreDaysOff] = useState<number[]>([]);
  const [selectedStore, setSelectedStore] = useState("");
  const [name, setName] = useState("");
  const [specification, setSpecification] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [productEmoji, setProductEmoji] = useState<(typeof PRODUCT_EMOJIS)[number]>("🍎");
  const [consumerPrice, setConsumerPrice] = useState("");
  const [comparisonPrice, setComparisonPrice] = useState("");
  const [comparisonVendor, setComparisonVendor] = useState("");
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [type, setType] = useState<"slot" | "instant">("slot");
  const [slotSize, setSlotSize] = useState("");
  const [availableQuantity, setAvailableQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [section, setSection] = useState<"orders" | "catalog">("orders");

  useEffect(() => { void checkOperator(); }, []);
  async function checkOperator() {
    const supabase = createClient();
    if (!supabase) { setLoading(false); setNotice("Supabase 설정이 필요합니다."); setError(true); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); setSignedIn(false); return; }
    setSignedIn(true);
    const { data: profile, error: profileError } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (profileError || profile?.role !== "operator") { setLoading(false); setAuthorized(false); return; }
    setAuthorized(true);
    await loadData();
    setLoading(false);
  }
  async function loadData() {
    const supabase = createClient();
    if (!supabase) return;
    const [{ data: storeData }, { data: productData }] = await Promise.all([
      supabase.from("stores").select("id,name,area,address,opening_time,closing_time,closed_weekdays,active").order("created_at", { ascending: false }),
      supabase.from("products").select("id,store_id,name,specification,description,image_url,consumer_price,type,slot_size,available_quantity,active,stores(id,name,area,address,opening_time,closing_time,closed_weekdays,active),price_comparisons(id,vendor,price,specification)").order("created_at", { ascending: false }),
    ]);
    setStores((storeData ?? []) as StoreRow[]);
    setItems((productData ?? []) as ProductRow[]);
    if (storeData?.length && !selectedStore) setSelectedStore(storeData[0].id);
  }
  function showNotice(message: string, isError = false) { setNotice(message); setError(isError); window.setTimeout(() => setNotice(""), 3500); }
  async function kakaoLogin() {
    const supabase = createClient();
    if (!supabase) { showNotice("Supabase와 Kakao 인증 환경 변수를 설정한 뒤 관리자 로그인을 사용할 수 있어요.", true); return; }
    window.location.assign("/auth/kakao/start?next=/admin");
  }
  async function addStore(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) return;
    if (!storeName.trim() || !storeArea.trim() || !storeAddress.trim()) { showNotice("가게 이름, 동네, 주소를 입력해 주세요.", true); return; }
    setSaving(true);
    const { data, error: insertError } = await supabase.from("stores").insert({ name: storeName.trim(), area: storeArea.trim(), address: storeAddress.trim(), sms_phone: storePhone.trim() || null, opening_time: storeOpeningTime, closing_time: storeClosingTime, closed_weekdays: storeDaysOff }).select("id,name,area,address,opening_time,closing_time,closed_weekdays,active").single();
    setSaving(false);
    if (insertError || !data) { showNotice(insertError?.message ?? "가게를 저장하지 못했어요.", true); return; }
    setStores((previous) => [data as StoreRow, ...previous]);
    setSelectedStore(data.id); setStoreName(""); setStoreArea(""); setStoreAddress(""); setStorePhone(""); setStoreOpeningTime("09:00"); setStoreClosingTime("20:00"); setStoreDaysOff([]);
    showNotice(`${data.name} 등록 완료 · 다른 가게도 이어서 추가할 수 있어요.`);
  }
  async function addProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) return;
    if (!selectedStore) { showNotice("먼저 청과점을 등록해 주세요.", true); return; }
    setSaving(true);
    const values = {
      // image_url also stores the selected emoji when no product photo URL is provided.
      store_id: selectedStore, name: name.trim(), specification: specification.trim(), description: description.trim(), image_url: imageUrl.trim() || productEmoji,
      consumer_price: Number(consumerPrice), type,
      slot_size: type === "slot" && slotSize ? Number(slotSize) : null, available_quantity: availableQuantity ? Number(availableQuantity) : null,
    };
    const editingProduct = editingProductId ? items.find((item) => item.id === editingProductId) : null;
    const productSelect = "id,store_id,name,specification,description,image_url,consumer_price,type,slot_size,available_quantity,active,stores(id,name,area,address,opening_time,closing_time,closed_weekdays,active),price_comparisons(id,vendor,price,specification)";
    const { data, error: insertError } = editingProductId
      ? await supabase.from("products").update(values).eq("id", editingProductId).select(productSelect).single()
      : await supabase.from("products").insert({ ...values, supply_price: 0, active: true }).select(productSelect).single();
    if (insertError || !data) { setSaving(false); showNotice(insertError?.message ?? "상품을 저장하지 못했어요.", true); return; }
    if (Number(comparisonPrice) > 0) {
      const existingComparison = editingProduct?.price_comparisons?.[0];
      const comparisonValues = { vendor: comparisonVendor.trim() || "주변 판매가", price: Number(comparisonPrice), specification: specification.trim() };
      const comparisonResult = existingComparison
        ? await supabase.from("price_comparisons").update(comparisonValues).eq("id", existingComparison.id)
        : await supabase.from("price_comparisons").insert({ product_id: data.id, ...comparisonValues });
      if (comparisonResult.error) { setSaving(false); await loadData(); showNotice("상품은 등록했지만 비교 가격 저장에 실패했어요.", true); return; }
    } else if (editingProduct?.price_comparisons?.length) {
      const { error: comparisonError } = await supabase.from("price_comparisons").delete().eq("product_id", editingProduct.id);
      if (comparisonError) { setSaving(false); await loadData(); showNotice("상품은 저장했지만 비교 가격을 삭제하지 못했어요.", true); return; }
    }
    setSaving(false); await loadData(); resetProductForm();
    showNotice(editingProductId ? "상품 정보를 수정했어요." : "상품을 등록했어요. 고객 화면에 바로 표시됩니다.");
  }
  function resetProductForm() {
    setEditingProductId(null); setName(""); setSpecification(""); setDescription(""); setImageUrl(""); setProductEmoji("🍎"); setConsumerPrice(""); setComparisonPrice(""); setComparisonVendor(""); setAvailableQuantity(""); setSlotSize(""); setType("slot");
  }
  function startEditingProduct(item: ProductRow) {
    const savedImage = item.image_url ?? "";
    const savedEmoji = PRODUCT_EMOJIS.find((emoji) => emoji === savedImage);
    setEditingProductId(item.id); setSelectedStore(item.store_id); setName(item.name); setSpecification(item.specification); setDescription(item.description ?? ""); setImageUrl(savedImage.startsWith("http") ? savedImage : ""); setProductEmoji(savedEmoji ?? "🍎"); setConsumerPrice(String(item.consumer_price)); setType(item.type); setSlotSize(item.slot_size ? String(item.slot_size) : ""); setAvailableQuantity(item.available_quantity === null ? "" : String(item.available_quantity));
    const comparison = item.price_comparisons?.[0];
    setComparisonPrice(comparison ? String(comparison.price) : ""); setComparisonVendor(comparison?.vendor ?? "");
    document.getElementById("product-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  async function toggleProduct(item: ProductRow) {
    const supabase = createClient();
    if (!supabase) return;
    const { error: updateError } = await supabase.from("products").update({ active: !item.active }).eq("id", item.id);
    if (updateError) { showNotice(updateError.message, true); return; }
    setItems((previous) => previous.map((entry) => entry.id === item.id ? { ...entry, active: !entry.active } : entry));
  }
  async function toggleStore(store: StoreRow) {
    const supabase = createClient();
    if (!supabase) return;
    const { error: updateError } = await supabase.from("stores").update({ active: !store.active }).eq("id", store.id);
    if (updateError) { showNotice(updateError.message, true); return; }
    setStores((previous) => previous.map((entry) => entry.id === store.id ? { ...entry, active: !store.active } : entry));
    if (selectedStore === store.id && store.active) setSelectedStore("");
  }

  if (loading) return <main className="admin-app"><header className="admin-top"><a href="/"><ArrowLeft size={17}/>맵소사</a><b>관리자</b></header><div className="admin-content"><div className="admin-empty">관리자 정보를 확인하고 있어요…</div></div></main>;
  if (!signedIn) return <main className="admin-app"><header className="admin-top"><a href="/"><ArrowLeft size={17}/>맵소사</a><b>관리자</b></header><div className="admin-content"><div className="admin-heading"><span className="section-kicker">MAPSOSA ADMIN</span><h1>관리자 로그인</h1><p>카카오 계정으로 로그인해 상품을 관리해요.</p></div>{notice && <div className={error ? "admin-notice error" : "admin-notice"}>{notice}</div>}<section className="admin-card"><button className="admin-save" onClick={() => void kakaoLogin()}>카카오로 로그인</button></section></div></main>;
  if (!authorized) return <main className="admin-app"><header className="admin-top"><a href="/"><ArrowLeft size={17}/>맵소사</a><b>관리자</b></header><div className="admin-content"><div className="admin-heading"><span className="section-kicker">MAPSOSA ADMIN</span><h1>접근할 수 없어요</h1><p>이 계정에는 상품 관리 권한이 없습니다.</p></div><section className="admin-card"><p className="admin-help">관리 권한은 Supabase의 `profiles.role`을 `operator`로 설정한 계정에만 부여됩니다.</p></section></div></main>;

  return <main className="admin-app">
    <header className="admin-top"><a href="/"><ArrowLeft size={17}/>고객 화면</a><b>맵소사 관리자</b><Store size={18} color="#2f8f4e"/></header>
    <div className="admin-content">
      <div className="admin-heading"><span className="section-kicker">MAPSOSA ADMIN</span><h1>{section === "orders" ? "주문과 입금 관리" : "가게와 상품 관리"}</h1><p>{section === "orders" ? "픽업일별 주문 총량을 보고 입금과 확정 처리를 해요." : "가게를 여러 곳 등록한 뒤, 각 가게의 상품을 연결해 주세요."}</p></div>
      <div className="admin-main-tabs"><button className={section === "orders" ? "selected" : ""} onClick={() => setSection("orders")}>주문 · 입금</button><button className={section === "catalog" ? "selected" : ""} onClick={() => setSection("catalog")}>가게 · 상품</button></div>
      {notice && <div className={error ? "admin-notice error" : "admin-notice"}>{!error && <Check size={14} style={{ verticalAlign: "middle", marginRight: 5 }}/>} {notice}</div>}
      {section === "orders" ? <AdminOrders/> : <>
      <form className="admin-card admin-fields" onSubmit={(event) => void addStore(event)}>
        <h2>청과점 등록</h2>
        <p className="admin-help">가게를 한 곳씩 추가할 수 있어요. 등록 후 다른 가게도 이어서 입력하세요.</p>
        <div className="admin-field-pair"><div className="admin-field"><label htmlFor="store-name">가게 이름</label><input id="store-name" value={storeName} onChange={(event) => setStoreName(event.target.value)} placeholder="예: 망원청과" required/></div><div className="admin-field"><label htmlFor="store-area">동네 / 시장</label><input id="store-area" value={storeArea} onChange={(event) => setStoreArea(event.target.value)} placeholder="예: 망원시장" required/></div></div>
        <div className="admin-field"><label htmlFor="store-address">가게 주소</label><input id="store-address" value={storeAddress} onChange={(event) => setStoreAddress(event.target.value)} required/></div>
        <div className="admin-field"><label htmlFor="store-phone">연락처 (선택)</label><input id="store-phone" value={storePhone} onChange={(event) => setStorePhone(event.target.value)} inputMode="tel" placeholder="010-0000-0000"/></div>
        <div className="admin-field-pair"><div className="admin-field"><label htmlFor="store-opening-time">오픈 시간</label><input id="store-opening-time" type="time" value={storeOpeningTime} onChange={(event) => setStoreOpeningTime(event.target.value)} required/></div><div className="admin-field"><label htmlFor="store-closing-time">마감 시간</label><input id="store-closing-time" type="time" value={storeClosingTime} onChange={(event) => setStoreClosingTime(event.target.value)} required/></div></div>
        <div className="admin-field"><label>정기 휴무</label><div className="admin-day-checks">{[[0,"일"],[1,"월"],[2,"화"],[3,"수"],[4,"목"],[5,"금"],[6,"토"]].map(([value,label]) => <label key={value}><input type="checkbox" checked={storeDaysOff.includes(Number(value))} onChange={(event) => setStoreDaysOff((days) => event.target.checked ? [...days, Number(value)] : days.filter((day) => day !== Number(value)))}/>{label}</label>)}</div></div>
        <button className="admin-save" type="submit" disabled={saving}>{saving ? "저장 중…" : "청과점 등록하고 다음 가게 추가"}</button>
      </form>
      <form id="product-form" className="admin-card admin-fields" onSubmit={(event) => void addProduct(event)}>
        <div className="admin-inline-title"><h2>{editingProductId ? "상품 정보 수정" : "새 상품 등록"}</h2>{editingProductId && <button type="button" onClick={resetProductForm}>수정 취소</button>}</div>
        <div className="admin-field"><label htmlFor="product-store">판매 청과점</label><select id="product-store" value={selectedStore} onChange={(event) => setSelectedStore(event.target.value)} required><option value="">청과점을 선택해 주세요</option>{stores.filter((store) => store.active || store.id === selectedStore).map((store) => <option key={store.id} value={store.id}>{store.name} · {store.area}{store.active ? "" : " (운영 중지)"}</option>)}</select></div>
        <div className="admin-field"><label htmlFor="product-name">상품명</label><input id="product-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 아삭한 햇사과" required/></div>
        <div className="admin-field"><label htmlFor="product-spec">중량 / 규격</label><input id="product-spec" value={specification} onChange={(event) => setSpecification(event.target.value)} placeholder="예: 부사 · 500g" required/></div>
        <div className="admin-field"><label>상품 유형</label><div className="admin-segmented"><button type="button" className={type === "slot" ? "selected" : ""} onClick={() => setType("slot")}>슬롯형 · 모집형</button><button type="button" className={type === "instant" ? "selected" : ""} onClick={() => { setType("instant"); setSlotSize(""); }}>즉시구매형</button></div></div>
        {type === "slot" && <div className="admin-field"><label htmlFor="slot-size">슬롯 단위 (선택)</label><input id="slot-size" type="number" min="1" max="100" value={slotSize} onChange={(event) => setSlotSize(event.target.value)} placeholder="예: 4"/><p className="admin-help">세트 단위가 있는 상품에만 입력해 주세요. 비워 두면 단위 제한 없이 모집합니다.</p></div>}
        <div className="admin-field"><label htmlFor="available-quantity">등록 수량 (선택)</label><input id="available-quantity" type="number" min="0" inputMode="numeric" value={availableQuantity} onChange={(event) => setAvailableQuantity(event.target.value)} placeholder="제한 없이 모집하려면 비워 두세요"/></div>
        <div className="admin-field"><label htmlFor="consumer-price">판매 가격 (원)</label><input id="consumer-price" type="number" min="0" inputMode="numeric" value={consumerPrice} onChange={(event) => setConsumerPrice(event.target.value)} required/></div>
        <div className="admin-field-pair"><div className="admin-field"><label htmlFor="comparison-price">비교 가격 (선택)</label><input id="comparison-price" type="number" min="0" inputMode="numeric" value={comparisonPrice} onChange={(event) => setComparisonPrice(event.target.value)} placeholder="원"/></div><div className="admin-field"><label htmlFor="comparison-vendor">비교처</label><input id="comparison-vendor" value={comparisonVendor} onChange={(event) => setComparisonVendor(event.target.value)} placeholder="예: 주변 마트"/></div></div>
        <div className="admin-field"><label htmlFor="product-description">상품 설명 (선택)</label><textarea id="product-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="산지, 맛, 보관 방법 등을 적어 주세요."/></div>
        <div className="admin-field"><span className="admin-field-label">상품 이모지</span><div className="product-emoji-picker" role="group" aria-label="상품 이모지 선택">{PRODUCT_EMOJIS.map((emoji) => <button key={emoji} type="button" className={productEmoji === emoji ? "selected" : ""} aria-label={`${emoji} 선택`} aria-pressed={productEmoji === emoji} onClick={() => setProductEmoji(emoji)}>{emoji}</button>)}</div><small className="admin-help">상품 사진 주소를 입력하면 사진이 보이고, 비워 두면 선택한 이모지가 보여요.</small></div>
        <div className="admin-field"><label htmlFor="product-image">상품 이미지 주소 (선택)</label><input id="product-image" type="url" inputMode="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…"/></div>
        <button className="admin-save" type="submit" disabled={saving || stores.length === 0}>{saving ? "저장 중…" : editingProductId ? "상품 수정 저장" : "상품 등록하기"}</button>
      </form>

      <section className="admin-card"><h2>등록된 상품 <span style={{ color: "#7a847b", fontWeight: 500 }}>({items.length})</span></h2>{items.length ? <div className="admin-product-list">{items.map((item) => { const store = Array.isArray(item.stores) ? item.stores[0] : item.stores; const visual = item.image_url || "🍎"; return <article className="admin-product-row" key={item.id}><span className="admin-product-emoji">{visual.startsWith("http") ? <img src={visual} alt=""/> : visual}</span><div className="admin-product-copy"><b>{item.name} · {item.specification}</b><span>{store?.name ?? "청과점"} · {won(item.consumer_price)}원{item.slot_size ? ` · ${item.slot_size}개 단위` : " · 단위 제한 없음"}</span></div><div className="admin-row-actions"><button className="admin-edit" onClick={() => startEditingProduct(item)}>수정</button><button className={item.active ? "active-toggle" : "active-toggle inactive"} onClick={() => void toggleProduct(item)}>{item.active ? "판매 중" : "숨김"}</button></div></article>; })}</div> : <div className="admin-empty">아직 등록된 상품이 없어요. 위에서 상품을 등록해 주세요.</div>}</section>
      <section className="admin-card"><h2>등록된 청과점 <span style={{ color: "#7a847b", fontWeight: 500 }}>({stores.length})</span></h2>{stores.length ? <div className="admin-product-list">{stores.map((store) => <article className="admin-product-row" key={store.id}><span className="admin-product-emoji"><Store size={18}/></span><div className="admin-product-copy"><b>{store.name}</b><span>{store.area} · {store.address} · {store.opening_time ? `${store.opening_time.slice(0, 5)} 오픈` : "오픈 시간 미등록"}–{store.closing_time.slice(0, 5)} 마감</span></div><button className={store.active ? "active-toggle" : "active-toggle inactive"} onClick={() => void toggleStore(store)}>{store.active ? "운영 중" : "중지"}</button></article>)}</div> : <div className="admin-empty">위의 청과점 등록에서 첫 번째 가게를 추가해 주세요. 필요한 만큼 계속 등록할 수 있어요.</div>}</section>
      </>}
    </div>
  </main>;
}
