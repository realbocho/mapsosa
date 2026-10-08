"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function AnalyticsConsent({ userId }: { userId: string }) {
  const [consent, setConsent] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    let alive = true;
    void supabase.from("profiles").select("analytics_consent").eq("id", userId).single().then(({ data }) => {
      if (alive && data) setConsent(Boolean(data.analytics_consent));
    });
    return () => { alive = false; };
  }, [userId]);
  async function update(value: boolean) {
    const supabase = createClient();
    if (!supabase) return;
    setSaving(true); setMessage("");
    const { error } = await supabase.from("profiles").update({ analytics_consent: value, analytics_consent_updated_at: new Date().toISOString() }).eq("id", userId);
    setSaving(false);
    if (error) { setMessage("동의 설정을 저장하지 못했어요."); return; }
    setConsent(value); setMessage(value ? "이용 분석에 동의했어요." : "이용 분석 동의를 철회했어요.");
  }
  if (consent === null) return null;
  return <section className="analytics-consent"><div><b>서비스 이용 분석 (선택)</b><p>가게 상세 열기, 장바구니 담기, 주문 화면 진입을 기록해 서비스 개선에 사용해요. 동의하지 않아도 이용할 수 있어요.</p></div>
    <button disabled={saving} onClick={() => void update(!consent)}>{saving ? "저장 중…" : consent ? "동의 철회" : "동의하기"}</button>{message && <small role="status">{message}</small>}
  </section>;
}
