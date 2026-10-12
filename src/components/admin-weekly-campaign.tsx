"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Plus, Store, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatPickupDate, nextPickupDate } from "@/lib/pickup-dates";

type StoreOption = { id: string; name: string; area: string; active: boolean; closed_weekdays: number[] };
type Tier = { minimum_slots: string; unit_price: string };
type StoreSetup = { enabled: boolean; tiers: Tier[] };
const EMOJIS = ["🍎", "🍐", "🍊", "🍋", "🍇", "🍓", "🫐", "🍑", "🥭", "🥝", "🥬", "🥕"];

function addDays(date: string, amount: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export function AdminWeeklyCampaign({ stores }: { stores: StoreOption[] }) {
  const defaultDate = nextPickupDate("토요일");
  const dates = useMemo(() => Array.from({ length: 9 }, (_, index) => addDays(defaultDate, index * 7)), [defaultDate]);
  const [pickupDate, setPickupDate] = useState(defaultDate);
  const [name, setName] = useState("");
  const [specification, setSpecification] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("🍎");
  const [imageUrl, setImageUrl] = useState("");
  const [storeSetups, setStoreSetups] = useState<Record<string, StoreSetup>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeError, setNoticeError] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let active = true;
    setLoading(true);
    void supabase.from("weekly_campaigns")
      .select("id,name,specification,description,image_url,weekly_campaign_stores(id,store_id,weekly_price_tiers(minimum_slots,unit_price))")
      .eq("pickup_date", pickupDate).maybeSingle().then(({ data, error }) => {
        if (!active) return;
        if (error) { setNotice(`상품 정보를 불러오지 못했어요: ${error.message}`); setNoticeError(true); }
        if (data) {
          setName(data.name);
          setSpecification(data.specification);
          setDescription(data.description ?? "");
          const savedImage = data.image_url ?? "";
          if (EMOJIS.includes(savedImage)) { setImage(savedImage); setImageUrl(""); }
          else { setImage("🍎"); setImageUrl(savedImage); }
          const setups: Record<string, StoreSetup> = {};
          for (const entry of (data.weekly_campaign_stores ?? []) as unknown as { store_id: string; weekly_price_tiers: { minimum_slots: number; unit_price: number }[] }[]) {
            setups[entry.store_id] = { enabled: true, tiers: [...(entry.weekly_price_tiers ?? [])].sort((a, b) => a.minimum_slots - b.minimum_slots).map((tier) => ({ minimum_slots: String(tier.minimum_slots), unit_price: String(tier.unit_price) })) };
          }
          setStoreSetups(setups);
        } else {
          setName(""); setSpecification(""); setDescription(""); setImage("🍎"); setImageUrl(""); setStoreSetups({});
        }
        setLoading(false);
      });
    return () => { active = false; };
  }, [pickupDate]);

  function setupFor(storeId: string): StoreSetup {
    return storeSetups[storeId] ?? { enabled: false, tiers: [{ minimum_slots: "1", unit_price: "" }] };
  }
  function updateSetup(storeId: string, value: StoreSetup) {
    setStoreSetups((current) => ({ ...current, [storeId]: value }));
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supabase = createClient();
    if (!supabase) return;
    const participating = stores.filter((store) => store.active && !store.closed_weekdays.includes(6) && setupFor(store.id).enabled);
    if (!participating.length) { setNotice("참여 가게를 한 곳 이상 선택해 주세요."); setNoticeError(true); return; }
    const payload = participating.map((store) => {
      const tiers = setupFor(store.id).tiers.map((tier) => ({ minimum_slots: Number(tier.minimum_slots), unit_price: Number(tier.unit_price) })).sort((a, b) => a.minimum_slots - b.minimum_slots);
      if (!tiers.length || tiers.some((tier) => !Number.isInteger(tier.minimum_slots) || tier.minimum_slots < 1 || !Number.isInteger(tier.unit_price) || tier.unit_price < 0)) throw new Error(`${store.name}의 가격 구간을 확인해 주세요.`);
      if (tiers[0].minimum_slots !== 1) throw new Error(`${store.name}의 첫 가격 구간은 1슬롯부터 시작해야 해요.`);
      if (tiers.some((tier, index) => index > 0 && (tier.minimum_slots <= tiers[index - 1].minimum_slots || tier.unit_price > tiers[index - 1].unit_price))) throw new Error(`${store.name}은 슬롯 기준을 오름차순으로, 단가는 같거나 낮아지게 입력해 주세요.`);
      return { store_id: store.id, tiers };
    });
    setSaving(true); setNotice("");
    try {
      const { error } = await supabase.rpc("save_weekly_campaign", {
        p_pickup_date: pickupDate, p_name: name.trim(), p_specification: specification.trim(),
        p_description: description.trim(), p_image_url: imageUrl.trim() || image, p_stores: payload,
      });
      if (error) throw new Error(error.message);
      setNotice(`${formatPickupDate(pickupDate)} 공동구매 상품과 가게별 가격을 저장했어요.`);
      setNoticeError(false);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "저장하지 못했어요.");
      setNoticeError(true);
    } finally { setSaving(false); }
  }

  return <section className="weekly-campaign-wrap">
    {notice && <p className={`admin-notice${noticeError ? " error" : ""}`} role="status">{!noticeError && <Check size={14}/>} {notice}</p>}
    <form className="admin-card admin-fields weekly-campaign-form" onSubmit={(event) => void save(event)}>
      <div className="weekly-campaign-heading"><span className="weekly-campaign-icon">✳</span><div><span className="section-kicker">SATURDAY PICK</span><h2>이번 주 단일 상품</h2><p>품목은 모든 가게에서 같고, 가격 구간은 가게마다 따로 설정해요.</p></div></div>
      <div className="admin-field"><label htmlFor="weekly-pickup-date">픽업 토요일</label><select id="weekly-pickup-date" value={pickupDate} onChange={(event) => setPickupDate(event.target.value)}>{dates.map((date) => <option key={date} value={date}>{formatPickupDate(date)}</option>)}</select></div>
      {loading ? <div className="admin-empty">해당 주의 상품 설정을 불러오고 있어요…</div> : <>
        <div className="weekly-shared-product">
          <div className="weekly-shared-title"><span>{imageUrl ? "🖼️" : image}</span><b>모든 참여 가게에 공통으로 표시</b></div>
          <div className="admin-field"><label htmlFor="weekly-name">품목명</label><input id="weekly-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="예: 햇사과" required/></div>
          <div className="admin-field"><label htmlFor="weekly-spec">상품 규격</label><input id="weekly-spec" value={specification} onChange={(event) => setSpecification(event.target.value)} placeholder="예: 한 송이 · 500g" required/></div>
          <div className="admin-field"><label htmlFor="weekly-description">상품 안내 (선택)</label><textarea id="weekly-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="상품의 특징이나 픽업 안내를 적어 주세요."/></div>
          <div className="admin-field"><span className="admin-field-label">대표 이모지</span><div className="product-emoji-picker" role="group" aria-label="상품 이모지 선택">{EMOJIS.map((emoji) => <button type="button" key={emoji} className={image === emoji && !imageUrl ? "selected" : ""} aria-pressed={image === emoji && !imageUrl} onClick={() => { setImage(emoji); setImageUrl(""); }}>{emoji}</button>)}</div></div>
          <div className="admin-field"><label htmlFor="weekly-image">이미지 주소 (선택)</label><input id="weekly-image" type="url" value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…"/></div>
        </div>

      <div className="weekly-store-section"><div className="weekly-store-section-title"><div><h3>참여 가게와 가격 구간</h3><p>슬롯은 가격 구간을 계산하는 수량이에요. 기준을 넘어도 주문 수량은 모두 유지됩니다.</p></div><span>{participatingCount(stores, storeSetups)}곳</span></div>
          {stores.filter((store) => store.active && !store.closed_weekdays.includes(6)).length ? stores.filter((store) => store.active && !store.closed_weekdays.includes(6)).map((store) => {
            const setup = setupFor(store.id);
            return <article className={`weekly-store-setup${setup.enabled ? " enabled" : ""}`} key={store.id}>
              <label className="weekly-store-toggle"><input type="checkbox" checked={setup.enabled} onChange={(event) => updateSetup(store.id, { ...setup, enabled: event.target.checked })}/><span className="weekly-store-mark"><Store size={16}/></span><span><b>{store.name}</b><small>{store.area}</small></span><span className="weekly-check">{setup.enabled ? <Check size={15}/> : <Plus size={15}/>}</span></label>
              {setup.enabled && <div className="weekly-tier-editor"><div className="weekly-tier-label"><span>주문 슬롯 기준</span><span>슬롯당 가격</span><span/></div>{setup.tiers.map((tier, index) => <div className="weekly-tier-row" key={`${store.id}-${index}`}><label><input type="number" min="1" step="1" required value={tier.minimum_slots} onChange={(event) => updateSetup(store.id, { ...setup, tiers: setup.tiers.map((entry, entryIndex) => entryIndex === index ? { ...entry, minimum_slots: event.target.value } : entry) })}/><span>슬롯부터</span></label><label><input type="number" min="0" step="1" inputMode="numeric" required value={tier.unit_price} onChange={(event) => updateSetup(store.id, { ...setup, tiers: setup.tiers.map((entry, entryIndex) => entryIndex === index ? { ...entry, unit_price: event.target.value } : entry) })}/><span>원 / 상품</span></label><button type="button" className="weekly-tier-remove" aria-label="가격 구간 삭제" disabled={setup.tiers.length === 1} onClick={() => updateSetup(store.id, { ...setup, tiers: setup.tiers.filter((_, entryIndex) => entryIndex !== index) })}><Trash2 size={14}/></button></div>)}<button type="button" className="weekly-tier-add" onClick={() => updateSetup(store.id, { ...setup, tiers: [...setup.tiers, { minimum_slots: String(Math.max(1, ...setup.tiers.map((tier) => Number(tier.minimum_slots) || 0)) + 1), unit_price: "" }] })}><Plus size={14}/>가격 구간 추가</button></div>}
            </article>;
          }) : <div className="admin-empty">먼저 참여 가게를 등록해 주세요.</div>}
        </div>
        <aside className="weekly-campaign-tip"><b>입금·환불 기준</b><span>주문 시점의 가게별 가격으로 입금 안내를 합니다. 마감 후 더 낮은 가격 구간에 도달하면 확정 주문별 차액을 환불 대상으로 표시하며, 운영자가 직접 이체합니다.</span></aside>
        <button className="admin-save weekly-campaign-save" type="submit" disabled={saving || !stores.some((store) => store.active && !store.closed_weekdays.includes(6))}>{saving ? "공동구매 설정 저장 중…" : `${formatPickupDate(pickupDate)} 상품 저장`}</button>
      </>}
    </form>
  </section>;
}

function participatingCount(stores: StoreOption[], setups: Record<string, StoreSetup>) {
  return stores.filter((store) => store.active && setups[store.id]?.enabled).length;
}
