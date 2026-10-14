"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Plus, Store, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatPickupDate, upcomingPickupDates } from "@/lib/pickup-dates";

type StoreOption = { id: string; name: string; area: string; active: boolean; closed_weekdays: number[] };
type Tier = { minimum_slots: string; unit_price: string };
type StoreSetup = { enabled: boolean; tiers: Tier[] };
type CampaignItem = { id: string | null; draftKey: string; name: string; specification: string; description: string; image: string; imageUrl: string; storeSetups: Record<string, StoreSetup> };
const EMOJIS = ["🍎", "🍐", "🍊", "🍋", "🍇", "🍓", "🫐", "🍑", "🥭", "🥝", "🥬", "🥕"];

function newDraftKey() { return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`; }
function blankItem(): CampaignItem { return { id: null, draftKey: newDraftKey(), name: "", specification: "", description: "", image: "🍎", imageUrl: "", storeSetups: {} }; }
function itemKey(item: CampaignItem) { return item.id ?? item.draftKey; }
function pickupWeekday(date: string) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }

export function AdminWeeklyCampaign({ stores }: { stores: StoreOption[] }) {
  const defaultDate = upcomingPickupDates(1)[0];
  const dates = useMemo(() => upcomingPickupDates(9), []);
  const [pickupDate, setPickupDate] = useState(defaultDate);
  const [items, setItems] = useState<CampaignItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);
  const activeWeekday = pickupWeekday(pickupDate);
  const eligibleStores = stores.filter((store) => store.active && !store.closed_weekdays.includes(activeWeekday));

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let active = true;
    setLoading(true);
    setNotice("");
    void supabase.from("weekly_campaigns")
      .select("id,name,specification,description,image_url,weekly_campaign_stores(id,store_id,weekly_price_tiers(minimum_slots,unit_price))")
      .eq("pickup_date", pickupDate).eq("active", true).order("created_at")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) { setNotice(`상품 정보를 불러오지 못했어요: ${error.message}`); setNoticeError(true); setItems([]); }
        else {
          setItems(((data ?? []) as unknown as { id: string; name: string; specification: string; description: string | null; image_url: string | null; weekly_campaign_stores: { store_id: string; weekly_price_tiers: { minimum_slots: number; unit_price: number }[] }[] }[]).map((row) => {
            const setups: Record<string, StoreSetup> = {};
            for (const entry of row.weekly_campaign_stores ?? []) setups[entry.store_id] = { enabled: true, tiers: [...(entry.weekly_price_tiers ?? [])].sort((a, b) => a.minimum_slots - b.minimum_slots).map((tier) => ({ minimum_slots: String(tier.minimum_slots), unit_price: String(tier.unit_price) })) };
            const savedImage = row.image_url ?? "";
            return { id: row.id, draftKey: row.id, name: row.name, specification: row.specification, description: row.description ?? "", image: EMOJIS.includes(savedImage) ? savedImage : "🍎", imageUrl: EMOJIS.includes(savedImage) ? "" : savedImage, storeSetups: setups };
          }));
          setNoticeError(false);
        }
        setLoading(false);
      });
    return () => { active = false; };
  }, [pickupDate]);

  function updateItem(key: string, update: (item: CampaignItem) => CampaignItem) {
    setItems((current) => current.map((item) => itemKey(item) === key ? update(item) : item));
  }
  function setupFor(item: CampaignItem, storeId: string): StoreSetup {
    return item.storeSetups[storeId] ?? { enabled: false, tiers: [{ minimum_slots: "1", unit_price: "" }] };
  }
  function updateStoreSetup(key: string, storeId: string, update: (setup: StoreSetup) => StoreSetup) {
    updateItem(key, (item) => ({ ...item, storeSetups: { ...item.storeSetups, [storeId]: update(setupFor(item, storeId)) } }));
  }
  function participatingCount(item: CampaignItem) { return eligibleStores.filter((store) => item.storeSetups[store.id]?.enabled).length; }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setNotice(""); setNoticeError(false);
    try {
      const supabase = createClient();
      if (!supabase) throw new Error("Supabase 연결 설정을 확인해 주세요.");
      const payload = items.map((item) => {
        if (!item.name.trim() || !item.specification.trim()) throw new Error("각 품목의 이름과 상품 규격을 입력해 주세요.");
        const participating = eligibleStores.filter((store) => item.storeSetups[store.id]?.enabled);
        const itemStores = participating.map((store) => {
          const tiers = setupFor(item, store.id).tiers.map((tier) => ({ minimum_slots: Number(tier.minimum_slots), unit_price: Number(tier.unit_price) })).sort((a, b) => a.minimum_slots - b.minimum_slots);
          if (!tiers.length || tiers.some((tier) => !Number.isInteger(tier.minimum_slots) || tier.minimum_slots < 1 || !Number.isInteger(tier.unit_price) || tier.unit_price < 0)) throw new Error(`${item.name} · ${store.name}의 가격 구간을 확인해 주세요.`);
          if (tiers[0].minimum_slots !== 1) throw new Error(`${item.name} · ${store.name}의 첫 가격 구간은 1슬롯부터 시작해야 해요.`);
          if (tiers.some((tier, index) => index > 0 && (tier.minimum_slots <= tiers[index - 1].minimum_slots || tier.unit_price > tiers[index - 1].unit_price))) throw new Error(`${item.name} · ${store.name}은 슬롯 기준을 오름차순으로, 단가는 같거나 낮아지게 입력해 주세요.`);
          return { store_id: store.id, tiers };
        });
        return { campaign_id: item.id, name: item.name.trim(), specification: item.specification.trim(), description: item.description.trim(), image_url: item.imageUrl.trim() || item.image, stores: itemStores };
      });
      const { error } = await supabase.rpc("save_weekly_campaign_products", { p_pickup_date: pickupDate, p_products: payload });
      if (error) throw new Error(error.message);
      setNotice(`${formatPickupDate(pickupDate)} 품목 ${items.length}개를 저장했어요.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "저장하지 못했어요.");
      setNoticeError(true);
    } finally { setSaving(false); }
  }

  return <section className="weekly-campaign-wrap">
    {notice && <p className={`admin-notice${noticeError ? " error" : ""}`} role="status">{!noticeError && <Check size={14}/>} {notice}</p>}
    <form className="admin-card admin-fields weekly-campaign-form" onSubmit={(event) => void save(event)}>
      <div className="weekly-campaign-heading"><span className="weekly-campaign-icon">✳</span><div><span className="section-kicker">WEDNESDAY & SATURDAY PICK</span><h2>공동구매 품목 관리</h2><p>품목마다 참여 가게와 가격 구간을 설정해요. 선택한 픽업일의 모든 참여 가게에 같은 품목 정보가 표시됩니다.</p></div></div>
      <div className="admin-field"><label htmlFor="weekly-pickup-date">픽업일</label><select id="weekly-pickup-date" value={pickupDate} onChange={(event) => setPickupDate(event.target.value)}>{dates.map((date) => <option key={date} value={date}>{formatPickupDate(date)}</option>)}</select></div>
      {loading ? <div className="admin-empty">해당 픽업일의 품목을 불러오고 있어요…</div> : <>
        <div className="weekly-shared-products">
          {items.map((item, index) => {
            const key = itemKey(item);
            return <article className="weekly-shared-product" key={key}>
              <div className="weekly-shared-title"><span>{item.imageUrl ? "🖼️" : item.image}</span><b>공통 품목 {index + 1}</b><span className="weekly-shared-count">참여 가게 {participatingCount(item)}곳</span><button type="button" className="weekly-product-remove" aria-label={`${item.name || `공통 품목 ${index + 1}`} 삭제`} onClick={() => setItems((current) => current.filter((entry) => itemKey(entry) !== key))}><Trash2 size={15}/></button></div>
              <div className="admin-field"><label htmlFor={`weekly-name-${key}`}>품목명</label><input id={`weekly-name-${key}`} value={item.name} onChange={(event) => updateItem(key, (current) => ({ ...current, name: event.target.value }))} placeholder="예: 샤인머스켓" required/></div>
              <div className="admin-field"><label htmlFor={`weekly-spec-${key}`}>상품 규격</label><input id={`weekly-spec-${key}`} value={item.specification} onChange={(event) => updateItem(key, (current) => ({ ...current, specification: event.target.value }))} placeholder="예: 1송이 · 500g" required/></div>
              <div className="admin-field"><label htmlFor={`weekly-description-${key}`}>상품 안내 (선택)</label><textarea id={`weekly-description-${key}`} value={item.description} onChange={(event) => updateItem(key, (current) => ({ ...current, description: event.target.value }))} placeholder="상품 특징이나 픽업 안내를 적어 주세요."/></div>
              <div className="admin-field"><span className="admin-field-label">대표 이모지</span><div className="product-emoji-picker" role="group" aria-label={`${item.name || `품목 ${index + 1}`} 이모지 선택`}>{EMOJIS.map((emoji) => <button type="button" key={emoji} className={item.image === emoji && !item.imageUrl ? "selected" : ""} aria-pressed={item.image === emoji && !item.imageUrl} onClick={() => updateItem(key, (current) => ({ ...current, image: emoji, imageUrl: "" }))}>{emoji}</button>)}</div></div>
              <div className="admin-field"><label htmlFor={`weekly-image-${key}`}>이미지 주소 (선택)</label><input id={`weekly-image-${key}`} type="url" value={item.imageUrl} onChange={(event) => updateItem(key, (current) => ({ ...current, imageUrl: event.target.value }))} placeholder="https://…"/></div>
              <div className="weekly-store-section"><div className="weekly-store-section-title"><div><h3>참여 가게와 가격 구간</h3><p>슬롯은 가격 기준 수량이며, 주문 수량은 모두 유지됩니다.</p></div><span>{participatingCount(item)}곳</span></div>
                {eligibleStores.length ? eligibleStores.map((store) => {
                  const setup = setupFor(item, store.id);
                  return <article className={`weekly-store-setup${setup.enabled ? " enabled" : ""}`} key={store.id}>
                    <label className="weekly-store-toggle"><input type="checkbox" checked={setup.enabled} onChange={(event) => updateStoreSetup(key, store.id, (current) => ({ ...current, enabled: event.target.checked }))}/><span className="weekly-store-mark"><Store size={16}/></span><span><b>{store.name}</b><small>{store.area}</small></span><span className="weekly-check">{setup.enabled ? <Check size={15}/> : <Plus size={15}/>}</span></label>
                    {setup.enabled && <div className="weekly-tier-editor">
                      <div className="weekly-tier-label"><span>주문 슬롯 기준</span><span>슬롯당 가격</span><span/></div>
                      {setup.tiers.map((tier, tierIndex) => <div className="weekly-tier-row" key={`${store.id}-${tierIndex}`}>
                        <label><input type="number" min="1" step="1" required value={tier.minimum_slots} onChange={(event) => updateStoreSetup(key, store.id, (current) => ({ ...current, tiers: current.tiers.map((entry, entryIndex) => entryIndex === tierIndex ? { ...entry, minimum_slots: event.target.value } : entry) }))}/><span>슬롯부터</span></label>
                        <label><input type="number" min="0" step="1" inputMode="numeric" required value={tier.unit_price} onChange={(event) => updateStoreSetup(key, store.id, (current) => ({ ...current, tiers: current.tiers.map((entry, entryIndex) => entryIndex === tierIndex ? { ...entry, unit_price: event.target.value } : entry) }))}/><span>원 / 상품</span></label>
                        <button type="button" className="weekly-tier-remove" aria-label="가격 구간 삭제" disabled={setup.tiers.length === 1} onClick={() => updateStoreSetup(key, store.id, (current) => ({ ...current, tiers: current.tiers.filter((_, entryIndex) => entryIndex !== tierIndex) }))}><Trash2 size={14}/></button>
                      </div>)}
                      <button type="button" className="weekly-tier-add" onClick={() => updateStoreSetup(key, store.id, (current) => ({ ...current, tiers: [...current.tiers, { minimum_slots: String(Math.max(1, ...current.tiers.map((tier) => Number(tier.minimum_slots) || 0)) + 1), unit_price: "" }] }))}><Plus size={14}/>가격 구간 추가</button>
                    </div>}
                  </article>;
                }) : <div className="admin-empty">선택한 요일에 영업하는 가게가 없습니다.</div>}
                {participatingCount(item) === 0 && <p className="weekly-campaign-no-stores">참여 가게 없이 품목만 저장할 수 있어요. 참여 가게를 추가할 때까지 고객 화면에 표시되지 않습니다.</p>}
              </div>
            </article>;
          })}
        </div>
        <button type="button" className="weekly-add-product" onClick={() => setItems((current) => [...current, blankItem()])}><Plus size={16}/>공통 품목 추가</button>
        {items.length === 0 && <p className="weekly-campaign-no-stores">등록한 품목이 없습니다. 품목을 추가하면 해당 픽업일에 판매할 수 있어요.</p>}
        <aside className="weekly-campaign-tip"><b>입금·환불 기준</b><span>주문 시점의 가게별 가격으로 입금 안내를 합니다. 마감 후 더 낮은 가격 구간에 도달하면 확정 주문별 차액을 환불 대상으로 표시하며, 운영자가 직접 이체합니다.</span></aside>
        <button className="admin-save weekly-campaign-save" type="submit" disabled={saving || loading}>{saving ? "품목 설정 저장 중…" : `${formatPickupDate(pickupDate)} 품목 설정 저장`}</button>
      </>}
    </form>
  </section>;
}
