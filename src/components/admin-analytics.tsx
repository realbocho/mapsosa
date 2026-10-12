"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { won } from "@/lib/products";
import { formatPickupDate, nextPickupDate } from "@/lib/pickup-dates";

type Week = { week_start: string; is_current_week: boolean; paid_customers: number; new_customers: number; repeat_customers: number; gross_gmv: number; refund_amount: number; net_gmv: number; active_start: number; active_end: number; churned_customers: number; churn_rate: number | null; referral_customers: number; organic_customers: number; paid_acquisition_customers: number; store_detail_events: number; add_to_cart_events: number; checkout_started_events: number; marketing_spend: number; history_weeks: number; direct_paid_customers: number; assisted_paid_customers: number; unidentified_assisted_orders: number };
type Retention = { cohort_week: string; cohort_size: number; week_number: number; retained_customers: number; retention_rate: number; acquisition_path: "direct" | "assisted" };
type Supply = { pickup_date: string; store_name: string; product_name: string; awaiting_payment_quantity: number; paid_quantity: number; confirmed_quantity: number; refund_quantity: number; paid_order_count: number };
type PickupNetProfit = { pickup_date: string; amount: number; updated_at: string };
const day = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });

export function AdminAnalytics() {
  const [weeks, setWeeks] = useState<Week[]>([]); const [retention, setRetention] = useState<Retention[]>([]); const [supply, setSupply] = useState<Supply[]>([]);
  const [signupCount, setSignupCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [campaign, setCampaign] = useState(""); const [spend, setSpend] = useState(""); const [saving, setSaving] = useState(false);
  const [netProfits, setNetProfits] = useState<PickupNetProfit[]>([]);
  const [profitPickupDate, setProfitPickupDate] = useState(() => nextPickupDate("토요일"));
  const [profitAmount, setProfitAmount] = useState("");
  const [savingProfit, setSavingProfit] = useState(false);
  const [profitNotice, setProfitNotice] = useState("");
  const load = useCallback(async () => {
    const supabase = createClient(); if (!supabase) { setError("Supabase 설정이 필요합니다."); setLoading(false); return; }
    setLoading(true); setError("");
    const [w, r, s, signups, profitResult] = await Promise.all([
      supabase.rpc("operator_weekly_growth_metrics", { p_weeks: 16 }),
      supabase.rpc("operator_retention_cohorts", { p_cohorts: 8 }),
      supabase.rpc("operator_supply_metrics", { p_pickup_count: 8 }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer").neq("id", "f022cd30-1a39-457b-adaf-48f3c109965d"),
      supabase.from("pickup_net_profits").select("pickup_date,amount,updated_at").order("pickup_date", { ascending: false }).limit(1000),
    ]);
    const failure = w.error ?? r.error ?? s.error ?? signups.error ?? profitResult.error;
    if (failure) setError(`분석 자료를 불러오지 못했어요. 마이그레이션 적용 여부를 확인해 주세요. (${failure.message})`);
    setWeeks((w.data ?? []) as Week[]); setRetention((r.data ?? []) as Retention[]); setSupply((s.data ?? []) as Supply[]); setSignupCount(signups.error ? null : signups.count ?? 0); setLoading(false);
    setNetProfits((profitResult.data ?? []).map((row) => ({ ...row, amount: Number(row.amount) })) as PickupNetProfit[]);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const existing = netProfits.find((entry) => entry.pickup_date === profitPickupDate);
    setProfitAmount(existing ? String(existing.amount) : "");
  }, [profitPickupDate, netProfits]);
  useEffect(() => { setProfitNotice(""); }, [profitPickupDate]);
  async function saveNetProfit(event: React.FormEvent) {
    event.preventDefault();
    const amount = Number(profitAmount);
    const weekday = new Date(`${profitPickupDate}T00:00:00Z`).getUTCDay();
    const todaySeoul = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    if (profitPickupDate >= todaySeoul && weekday !== 6) { setProfitNotice("앞으로의 픽업 운영일은 토요일로 선택해 주세요."); return; }
    if (!Number.isSafeInteger(amount)) { setProfitNotice("순수익은 원 단위 정수로 입력해 주세요."); return; }
    const supabase = createClient();
    if (!supabase) { setProfitNotice("Supabase 설정을 확인해 주세요."); return; }
    setSavingProfit(true); setProfitNotice("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSavingProfit(false); setProfitNotice("관리자 로그인이 필요합니다."); return; }
    const updatedAt = new Date().toISOString();
    const { error: saveError } = await supabase.from("pickup_net_profits").upsert({ pickup_date: profitPickupDate, amount, updated_by: user.id, updated_at: updatedAt }, { onConflict: "pickup_date" });
    setSavingProfit(false);
    if (saveError) { setProfitNotice(`저장하지 못했어요: ${saveError.message}`); return; }
    setNetProfits((current) => [{ pickup_date: profitPickupDate, amount, updated_at: updatedAt }, ...current.filter((entry) => entry.pickup_date !== profitPickupDate)].sort((a, b) => b.pickup_date.localeCompare(a.pickup_date)));
    setProfitNotice(`${formatPickupDate(profitPickupDate)} 순수익을 저장했어요.`);
  }
  async function addSpend(event: React.FormEvent) {
    event.preventDefault(); const supabase = createClient(); if (!supabase || !campaign.trim() || Number(spend) <= 0) return;
    setSaving(true);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    const kstDate = new Date(Date.UTC(part("year"), part("month") - 1, part("day")));
    kstDate.setUTCDate(kstDate.getUTCDate() - ((kstDate.getUTCDay() + 6) % 7));
    const weekStart = kstDate.toISOString().slice(0, 10);
    const { data: { user } } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from("marketing_spend").insert({ week_start: weekStart, campaign: campaign.trim(), amount: Number(spend), created_by: user?.id });
    setSaving(false); if (insertError) { setError(insertError.message); return; }
    setCampaign(""); setSpend(""); await load();
  }
  const completed = weeks.filter((w) => !w.is_current_week).slice(-2);
  const prev = completed[0]; const last = completed[1];
  const growth = prev && last && prev.paid_customers ? (last.paid_customers / prev.paid_customers) - 1 : null;
  const churn = last?.churn_rate ?? null;
  const cc = churn && churn > 0 && last && last.history_weeks >= 9 ? (last.referral_customers + last.organic_customers) / churn : null;
  const activeRatio = cc && last ? last.active_end / cc : null;
  const cohortPaths = [...new Map(retention.map((row) => [`${row.cohort_week}:${row.acquisition_path}`, { date: row.cohort_week, path: row.acquisition_path }])).values()];
  const chartProfits = netProfits.slice(0, 12).reverse();
  const chartMax = Math.max(1, ...chartProfits.map((entry) => Math.abs(entry.amount)));
  const chartZeroY = 78;
  const chartScale = 52 / chartMax;
  const chartPoints = chartProfits.map((entry, index) => ({ ...entry, x: chartProfits.length === 1 ? 360 : 34 + index * (652 / (chartProfits.length - 1)), y: chartZeroY - entry.amount * chartScale }));
  return <div className="admin-analytics">
    <div className="ops-date-title"><div><h2>성장과 공급 현황</h2><p>입금 확인일 기준 · 한국 시간 주간 집계</p></div><button className="ops-refresh" onClick={() => void load()}>새로고침</button></div>
    {error && <p className="analytics-error">{error}</p>}{loading && <div className="admin-empty">분석 자료를 불러오고 있어요…</div>}
    {!loading && <>
      <section className="admin-card net-profit-card"><div className="net-profit-heading"><div><h3>픽업일별 순수익</h3><p>매출이나 비용에서 자동 계산하지 않아요. 픽업일별 순수익을 직접 입력해 주세요.</p></div><span>최근 12회</span></div>
        <form className="net-profit-form" onSubmit={(event) => void saveNetProfit(event)}><label htmlFor="net-profit-date">픽업일</label><input id="net-profit-date" type="date" value={profitPickupDate} onChange={(event) => setProfitPickupDate(event.target.value)} required/><label htmlFor="net-profit-amount">순수익 (원)</label><input id="net-profit-amount" type="number" step="1" inputMode="numeric" value={profitAmount} onChange={(event) => setProfitAmount(event.target.value)} placeholder="예: 35000 또는 -12000" required/><small>새 픽업은 매주 토요일이에요. 과거 수요일 기록은 수정할 수 있어요.</small><button className="admin-save" type="submit" disabled={savingProfit || profitAmount === ""}>{savingProfit ? "저장 중…" : netProfits.some((entry) => entry.pickup_date === profitPickupDate) ? "순수익 수정하기" : "순수익 저장하기"}</button></form>
        {profitNotice && <p className={`net-profit-notice${profitNotice.startsWith("저장하지") || profitNotice.includes("확인해") || profitNotice.includes("필요합니다") || profitNotice.includes("선택해") || profitNotice.includes("입력해") ? " error" : ""}`} role="status">{profitNotice}</p>}
        {chartProfits.length ? <><div className="net-profit-chart-wrap"><svg className="net-profit-chart" viewBox="0 0 720 150" role="img" aria-labelledby="net-profit-chart-title net-profit-chart-desc"><title id="net-profit-chart-title">최근 12개 픽업일 순수익</title><desc id="net-profit-chart-desc">픽업일 순서에 따른 직접 입력한 순수익 그래프입니다. 기준선 아래는 손실입니다.</desc><line x1="22" x2="698" y1={chartZeroY} y2={chartZeroY} className="net-profit-zero"/><text x="5" y={chartZeroY - 5} className="net-profit-axis-label">0</text>{chartPoints.length > 1 && <polyline points={chartPoints.map((point) => `${point.x},${point.y}`).join(" ")} className="net-profit-line"/>}{chartPoints.map((point) => <g key={point.pickup_date}><circle cx={point.x} cy={point.y} r="5" className={point.amount < 0 ? "net-profit-point loss" : "net-profit-point"}/><text x={point.x} y="140" textAnchor="middle" className="net-profit-date-label">{day(point.pickup_date)}</text></g>)}</svg></div><div className="net-profit-values" aria-label="픽업일별 순수익 수치">{chartProfits.map((entry) => <div key={entry.pickup_date}><span>{formatPickupDate(entry.pickup_date)}</span><b className={entry.amount < 0 ? "loss" : ""}>{entry.amount > 0 ? "+" : ""}{won(entry.amount)}원</b></div>)}</div></> : <div className="admin-empty net-profit-empty">아직 입력한 순수익이 없습니다. 픽업일별 금액을 저장하면 여기에 그래프가 표시돼요.</div>}
      </section>
      <section className="admin-card analytics-card"><h3>핵심 지표 · 최근 완료 주</h3><div className="analytics-kpis">
        <article><small>카카오 로그인 가입자</small><b>{signupCount === null ? "데이터 없음" : `${signupCount}명`}</b><span>관리자 계정 제외 · 누적</span></article>
        <article><small>입금 확인 구매자</small><b>{last?.paid_customers ?? 0}명</b><span>{last ? `${day(last.week_start)} 주 · 직접 ${last.direct_paid_customers} / 대리 ${last.assisted_paid_customers}` : "데이터 부족"}</span></article>
        <article><small>주간 성장률 · 목표 7%</small><b>{growth === null ? "데이터 부족" : `${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%`}</b><span>전주 대비</span></article>
        <article><small>신규 / 재구매</small><b>{last?.new_customers ?? 0} / {last?.repeat_customers ?? 0}명</b><span>입금 확인 고객</span></article>
        <article><small>GMV · 환불 차감</small><b>{won(last?.net_gmv ?? 0)}원</b><span>총 {won(last?.gross_gmv ?? 0)}원 · 환불 {won(last?.refund_amount ?? 0)}원</span></article>
        <article><small>4주 활성 고객</small><b>{last?.active_end ?? 0}명</b><span>주말 기준</span></article>
        <article><small>자연 CC · 활성/CC</small><b>{cc === null ? "데이터 부족" : `${Math.round(cc)}명 · ${Math.round((activeRatio ?? 0) * 100)}%`}</b><span>자기 보고 추천·자연 유입 / 이탈률</span></article>
        <article><small>유료 획득 비용 참고</small><b>{last?.paid_acquisition_customers ? `${won(Math.round(last.marketing_spend / last.paid_acquisition_customers))}원` : "데이터 부족"}</b><span>주간 광고비 ÷ 광고 유입 자기 보고 고객</span></article>
      </div><p className="admin-help">주간 성장률은 직접·대리 주문의 실제 구매자를 기준으로 계산합니다. 확인된 기존 계정은 한 구매자로 연결해 중복 계산을 막습니다. 구매자를 연결할 수 없는 과거 운영자 주문 또는 구매자 식별 정보 보유 기간이 지난 대리 주문 {last?.unidentified_assisted_orders ?? 0}건은 매출·공급에는 반영하되 고객 수와 재구매에서는 제외합니다. 첫 8주는 기준선 수집 기간이며 CC는 이탈률이나 표본이 부족하면 표시하지 않습니다.</p></section>
      <section className="admin-card"><h3>주간 성과</h3><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>주</th><th>고유 구매자</th><th>직접 주문</th><th>대리 주문</th><th>신규</th><th>재구매</th><th>GMV</th><th>환불</th></tr></thead><tbody>{weeks.slice(-12).reverse().map((w) => <tr key={w.week_start}><td>{day(w.week_start)}{w.is_current_week ? " · 진행 중" : ""}</td><td>{w.paid_customers}</td><td>{w.direct_paid_customers}</td><td>{w.assisted_paid_customers}</td><td>{w.new_customers}</td><td>{w.repeat_customers}</td><td>{won(w.gross_gmv)}원</td><td>{won(w.refund_amount)}원</td></tr>)}</tbody></table></div><p className="admin-help">직접 주문과 대리 주문은 경로별 수치이며, 동일 구매자가 두 경로를 쓴 주에는 경로별 건수에 각각 잡힐 수 있습니다. 고유 구매자 수는 계정 연결이 되어 있으면 중복 제거합니다.</p></section>
      <section className="admin-card"><h3>8주 재구매 코호트</h3><p className="admin-help">첫 입금 경로(직접 주문 / 대리 주문)별 고객 중 이후 해당 주차에 다시 입금한 비율입니다. 아직 지나지 않은 주차는 표시하지 않아요.</p>{cohortPaths.length ? <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>첫 입금 주 · 경로</th><th>구매자</th>{[1,2,3,4,5,6,7,8].map((i) => <th key={i}>W{i}</th>)}</tr></thead><tbody>{cohortPaths.map(({ date, path }) => { const rows = retention.filter((row) => row.cohort_week === date && row.acquisition_path === path); const size = rows[0]?.cohort_size ?? 0; return <tr key={`${date}:${path}`}><td>{day(date)} · {path === "assisted" ? "대리" : "직접"}</td><td>{size}</td>{[1,2,3,4,5,6,7,8].map((i) => <td key={i}>{rows.find((r) => r.week_number === i) ? `${Math.round((rows.find((r) => r.week_number === i)?.retention_rate ?? 0) * 100)}%` : "—"}</td>)}</tr>; })}</tbody></table></div> : <div className="admin-empty">8주 재구매 데이터를 쌓는 중이에요.</div>}</section>
      <section className="admin-card"><h3>탐색 흐름 · 선택 동의 이용자</h3><div className="analytics-funnel">{[["가게 상세 열기", last?.store_detail_events], ["장바구니 담기", last?.add_to_cart_events], ["주문 화면 진입", last?.checkout_started_events]].map(([label, amount]) => <article key={String(label)}><span>{label}</span><b>{Number(amount ?? 0).toLocaleString()}회</b></article>)}</div><p className="admin-help">주문 생성·입금·환불은 기존 주문 자료에서 집계하며, 행동 이벤트와 중복 계산하지 않습니다.</p></section>
      <section className="admin-card"><h3>광고비 기록</h3><p className="admin-help">캠페인별 지출을 입력하면 주간 분석에 포함됩니다. 고객 획득 비용은 지출액과 유입 집계가 충분해진 뒤 해석하세요.</p><form className="marketing-spend-form" onSubmit={(e) => void addSpend(e)}><input aria-label="캠페인명" placeholder="캠페인명" maxLength={100} value={campaign} onChange={(e) => setCampaign(e.target.value)} required/><input aria-label="광고비" type="number" min="1" placeholder="광고비 (원)" value={spend} onChange={(e) => setSpend(e.target.value)} required/><button className="admin-save" disabled={saving}>{saving ? "저장 중…" : "이번 주 광고비 기록"}</button></form></section>
      <section className="admin-card"><h3>픽업일 · 가게별 공급과 수요</h3>{supply.length ? <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>픽업일</th><th>가게 / 상품</th><th>입금 대기</th><th>입금 확인</th><th>확정</th><th>환불</th></tr></thead><tbody>{supply.map((row, i) => <tr key={`${row.pickup_date}-${row.store_name}-${row.product_name}-${i}`}><td>{day(row.pickup_date)}</td><td>{row.store_name} · {row.product_name}</td><td>{row.awaiting_payment_quantity}</td><td>{row.paid_quantity}</td><td>{row.confirmed_quantity}</td><td>{row.refund_quantity}</td></tr>)}</tbody></table></div> : <div className="admin-empty">최근 픽업 공급 데이터가 없습니다.</div>}</section>
    </>}
  </div>;
}
