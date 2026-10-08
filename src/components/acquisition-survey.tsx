"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const channels = [
  ["friend_referral", "지인 추천"], ["kakao_group", "카카오톡 단체방"], ["search", "검색"],
  ["social_community", "SNS / 커뮤니티"], ["paid_ad", "광고"], ["store_offline", "가게 / 오프라인"],
  ["other", "기타"], ["unknown", "기억나지 않음"],
] as const;

export function AcquisitionSurvey({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let alive = true;
    void Promise.all([
      supabase.from("profiles").select("created_at").eq("id", userId).single(),
      supabase.from("acquisition_surveys").select("user_id").eq("user_id", userId).maybeSingle(),
    ]).then(([profile, survey]) => {
      if (alive && !survey.data && profile.data && Date.now() - new Date(profile.data.created_at).getTime() >= 48 * 60 * 60 * 1000) setOpen(true);
    });
    return () => { alive = false; };
  }, [userId]);

  async function answer(status: "answered" | "skipped", channel: string | null) {
    const supabase = createClient();
    if (!supabase) return;
    setSaving(true); setError("");
    const { error: saveError } = await supabase.from("acquisition_surveys").insert({ user_id: userId, response_status: status, channel });
    setSaving(false);
    if (saveError) { setError("응답을 저장하지 못했어요. 잠시 후 다시 시도해 주세요."); return; }
    setOpen(false);
  }
  if (!open) return null;
  return <div className="mobile-modal-backdrop survey-backdrop"><section className="survey-card" role="dialog" aria-modal="true" aria-labelledby="survey-title">
    <span className="section-kicker">맵소사에 대해 알려주세요</span><h2 id="survey-title">맵소사를 처음 어디서 알게 되셨나요?</h2>
    <p>유입 경로를 파악하는 데 사용해요. 응답은 선택이며, 자유 입력은 받지 않아요.</p>
    <div className="survey-options">{channels.map(([value, label]) => <button key={value} disabled={saving} onClick={() => void answer("answered", value)}>{label}</button>)}</div>
    {error && <p className="survey-error">{error}</p>}
    <button className="survey-skip" disabled={saving} onClick={() => void answer("skipped", null)}>건너뛰기</button>
  </section></div>;
}
