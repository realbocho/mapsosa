"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { won } from "@/lib/products";

type Week = { week_start: string; is_current_week: boolean; paid_customers: number; new_customers: number; repeat_customers: number; gross_gmv: number; refund_amount: number; net_gmv: number; active_start: number; active_end: number; churned_customers: number; churn_rate: number | null; referral_customers: number; organic_customers: number; paid_acquisition_customers: number; store_detail_events: number; add_to_cart_events: number; checkout_started_events: number; marketing_spend: number; history_weeks: number };
type Retention = { cohort_week: string; cohort_size: number; week_number: number; retained_customers: number; retention_rate: number };
type Supply = { pickup_date: string; store_name: string; product_name: string; awaiting_payment_quantity: number; paid_quantity: number; confirmed_quantity: number; refund_quantity: number; paid_order_count: number };
const day = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });

export function AdminAnalytics() {
  const [weeks, setWeeks] = useState<Week[]>([]); const [retention, setRetention] = useState<Retention[]>([]); const [supply, setSupply] = useState<Supply[]>([]);
  const [signupCount, setSignupCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [campaign, setCampaign] = useState(""); const [spend, setSpend] = useState(""); const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const supabase = createClient(); if (!supabase) { setError("Supabase 설정이 필요합니다."); setLoading(false); return; }
    setLoading(true); setError("");
    const [w, r, s, signups] = await Promise.all([
      supabase.rpc("operator_weekly_growth_metrics", { p_weeks: 16 }),
      supabase.rpc("operator_retention_cohorts", { p_cohorts: 8 }),
      supabase.rpc("operator_supply_metrics", { p_pickup_count: 8 }),
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "customer").neq("id", "f022cd30-1a39-457b-adaf-48f3c109965d"),
    ]);
    const failure = w.error ?? r.error ?? s.error ?? signups.error;
    if (failure) setError(`분석 자료를 불러오지 못했어요. 마이그레이션 적용 여부를 확인해 주세요. (${failure.message})`);
    setWeeks((w.data ?? []) as Week[]); setRetention((r.data ?? []) as Retention[]); setSupply((s.data ?? []) as Supply[]); setSignupCount(signups.error ? null : signups.count ?? 0); setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
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
  const cohortDates = [...new Set(retention.map((r) => r.cohort_week))].slice(0, 8);
  const retentionByCohort = new Map(cohortDates.map((date) => [date, retention.filter((r) => r.cohort_week === date)]));
  return <div className="admin-analytics">
    <div className="ops-date-title"><div><h2>성장과 공급 현황</h2><p>입금 확인일 기준 · 한국 시간 주간 집계</p></div><button className="ops-refresh" onClick={() => void load()}>새로고침</button></div>
    {error && <p className="analytics-error">{error}</p>}{loading && <div className="admin-empty">분석 자료를 불러오고 있어요…</div>}
    {!loading && <>
      <section className="admin-card analytics-card"><h3>핵심 지표 · 최근 완료 주</h3><div className="analytics-kpis">
        <article><small>카카오 로그인 가입자</small><b>{signupCount === null ? "데이터 없음" : `${signupCount}명`}</b><span>관리자 계정 제외 · 누적</span></article>
        <article><small>입금 확인 고객</small><b>{last?.paid_customers ?? 0}명</b><span>{last ? `${day(last.week_start)} 주` : "데이터 부족"}</span></article>
        <article><small>주간 성장률 · 목표 7%</small><b>{growth === null ? "데이터 부족" : `${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%`}</b><span>전주 대비</span></article>
        <article><small>신규 / 재구매</small><b>{last?.new_customers ?? 0} / {last?.repeat_customers ?? 0}명</b><span>입금 확인 고객</span></article>
        <article><small>GMV · 환불 차감</small><b>{won(last?.net_gmv ?? 0)}원</b><span>총 {won(last?.gross_gmv ?? 0)}원 · 환불 {won(last?.refund_amount ?? 0)}원</span></article>
        <article><small>4주 활성 고객</small><b>{last?.active_end ?? 0}명</b><span>주말 기준</span></article>
        <article><small>자연 CC · 활성/CC</small><b>{cc === null ? "데이터 부족" : `${Math.round(cc)}명 · ${Math.round((activeRatio ?? 0) * 100)}%`}</b><span>자기 보고 추천·자연 유입 / 이탈률</span></article>
        <article><small>유료 획득 비용 참고</small><b>{last?.paid_acquisition_customers ? `${won(Math.round(last.marketing_spend / last.paid_acquisition_customers))}원` : "데이터 부족"}</b><span>주간 광고비 ÷ 광고 유입 자기 보고 고객</span></article>
      </div><p className="admin-help">주간 성장률은 완료된 주끼리 비교합니다. 첫 8주는 기준선 수집 기간이며 CC는 이탈률이나 표본이 부족하면 표시하지 않습니다.</p></section>
      <section className="admin-card"><h3>주간 성과</h3><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>주</th><th>입금 고객</th><th>신규</th><th>재구매</th><th>GMV</th><th>환불</th></tr></thead><tbody>{weeks.slice(-12).reverse().map((w) => <tr key={w.week_start}><td>{day(w.week_start)}{w.is_current_week ? " · 진행 중" : ""}</td><td>{w.paid_customers}</td><td>{w.new_customers}</td><td>{w.repeat_customers}</td><td>{won(w.gross_gmv)}원</td><td>{won(w.refund_amount)}원</td></tr>)}</tbody></table></div></section>
      <section className="admin-card"><h3>8주 재구매 코호트</h3><p className="admin-help">첫 입금 주차별 고객 중 이후 해당 주차에 다시 입금한 비율입니다. 아직 지나지 않은 주차는 표시하지 않아요.</p>{cohortDates.length ? <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>첫 입금 주</th><th>고객</th>{[1,2,3,4,5,6,7,8].map((i) => <th key={i}>W{i}</th>)}</tr></thead><tbody>{cohortDates.map((date) => { const rows = retentionByCohort.get(date) ?? []; const size = rows[0]?.cohort_size ?? 0; return <tr key={date}><td>{day(date)}</td><td>{size}</td>{[1,2,3,4,5,6,7,8].map((i) => <td key={i}>{rows.find((r) => r.week_number === i) ? `${Math.round((rows.find((r) => r.week_number === i)?.retention_rate ?? 0) * 100)}%` : "—"}</td>)}</tr>; })}</tbody></table></div> : <div className="admin-empty">8주 재구매 데이터를 쌓는 중이에요.</div>}</section>
      <section className="admin-card"><h3>탐색 흐름 · 선택 동의 이용자</h3><div className="analytics-funnel">{[["가게 상세 열기", last?.store_detail_events], ["장바구니 담기", last?.add_to_cart_events], ["주문 화면 진입", last?.checkout_started_events]].map(([label, amount]) => <article key={String(label)}><span>{label}</span><b>{Number(amount ?? 0).toLocaleString()}회</b></article>)}</div><p className="admin-help">주문 생성·입금·환불은 기존 주문 자료에서 집계하며, 행동 이벤트와 중복 계산하지 않습니다.</p></section>
      <section className="admin-card"><h3>광고비 기록</h3><p className="admin-help">캠페인별 지출을 입력하면 주간 분석에 포함됩니다. 고객 획득 비용은 지출액과 유입 집계가 충분해진 뒤 해석하세요.</p><form className="marketing-spend-form" onSubmit={(e) => void addSpend(e)}><input aria-label="캠페인명" placeholder="캠페인명" maxLength={100} value={campaign} onChange={(e) => setCampaign(e.target.value)} required/><input aria-label="광고비" type="number" min="1" placeholder="광고비 (원)" value={spend} onChange={(e) => setSpend(e.target.value)} required/><button className="admin-save" disabled={saving}>{saving ? "저장 중…" : "이번 주 광고비 기록"}</button></form></section>
      <section className="admin-card"><h3>픽업일 · 가게별 공급과 수요</h3>{supply.length ? <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>픽업일</th><th>가게 / 상품</th><th>입금 대기</th><th>입금 확인</th><th>확정</th><th>환불</th></tr></thead><tbody>{supply.map((row, i) => <tr key={`${row.pickup_date}-${row.store_name}-${row.product_name}-${i}`}><td>{day(row.pickup_date)}</td><td>{row.store_name} · {row.product_name}</td><td>{row.awaiting_payment_quantity}</td><td>{row.paid_quantity}</td><td>{row.confirmed_quantity}</td><td>{row.refund_quantity}</td></tr>)}</tbody></table></div> : <div className="admin-empty">최근 픽업 공급 데이터가 없습니다.</div>}</section>
    </>}
  </div>;
}
