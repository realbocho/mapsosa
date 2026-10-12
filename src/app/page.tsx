"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type UIEvent } from "react";
import { ArrowDown, ArrowLeftRight, ArrowRight, Check, Clock3, LocateFixed, MapPin, Minus, Plus, ShoppingBag, Sprout, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isProductImageUrl, won, type Product } from "@/lib/products";
import { StoreMap, type StoreCoordinate, type StoreLocation } from "@/components/store-map";
import { ProductImage } from "@/components/product-image";
import { LegalLinks } from "@/components/legal-links";
import { formatPickupDate, nextPickupDate, orderDeadlineTimestamp, type PickupDay } from "@/lib/pickup-dates";
import { AcquisitionSurvey } from "@/components/acquisition-survey";
import { AnalyticsConsent } from "@/components/analytics-consent";
import { newestOrderUpdate, orderUpdatesSeenKey } from "@/lib/order-notifications";

function distanceMeters(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(destination.latitude - origin.latitude);
  const longitudeDelta = radians(destination.longitude - origin.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(origin.latitude)) * Math.cos(radians(destination.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.max(10, Math.round(meters / 10) * 10)}m` : `${(meters / 1000).toFixed(1)}km`;
}

function addDaysToDate(date: string, amount: number) {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + amount));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export default function Home() {
  const pickupOptions = useMemo(() => {
    const first = nextPickupDate("토요일");
    return [first, addDaysToDate(first, 7)].map((date) => ({ day: "토요일" as PickupDay, date }));
  }, []);
  const [pickupDate, setPickupDate] = useState(() => pickupOptions[0].date);
  const pickup: PickupDay = "토요일";
  const [catalog, setCatalog] = useState<Product[]>([]);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [storeCoordinates, setStoreCoordinates] = useState<StoreCoordinate[]>([]);
  const [nearbySort, setNearbySort] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [sheetHeightPercent, setSheetHeightPercent] = useState<number | null>(null);
  const sheetDrag = useRef<{ pointerId: number; startY: number; startHeight: number; containerHeight: number } | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [checkout, setCheckout] = useState(false);
  const [showFinalReservationConfirm, setShowFinalReservationConfirm] = useState(false);
  const [showPaymentNotice, setShowPaymentNotice] = useState(false);
  const [confirmedOrderTotal, setConfirmedOrderTotal] = useState(0);
  const [confirmedPickupDate, setConfirmedPickupDate] = useState("");
  const [confirmedPickupStores, setConfirmedPickupStores] = useState<{ name: string; address: string }[]>([]);
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);
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
    const productsRequest = supabase.rpc("weekly_campaign_catalog", { p_pickup_date: pickupDate });
    void productsRequest.then(({ data }) => {
      if (!active) return;
      if (data) {
        setCatalog(data.map((row: { product_id: string; store_id: string; store_name: string; store_area: string; store_address: string; closed_weekdays: number[]; name: string; specification: string; description: string | null; image_url: string | null; applied_quantity: number; tiers: { minimum_slots: number; unit_price: number }[] | null }) => {
          const isFruit = /사과|배|포도|키위|딸기|귤|한라봉|복숭아|수박|참외/.test(row.name);
          const emoji = /사과/.test(row.name) ? "🍎" : /포도/.test(row.name) ? "🍇" : /딸기/.test(row.name) ? "🍓" : /배/.test(row.name) ? "🍐" : isFruit ? "🍊" : "🥬";
          const tiers = (row.tiers ?? []).map((tier) => ({ minimumSlots: Number(tier.minimum_slots), unitPrice: Number(tier.unit_price) })).sort((a, b) => a.minimumSlots - b.minimumSlots);
          return { id: row.product_id, storeId: row.store_id, name: row.name, variety: row.specification, store: row.store_name, area: row.store_area, price: tiers[0]?.unitPrice ?? 0, oldPrice: tiers[0]?.unitPrice ?? 0, unit: row.specification, type: "instant" as const, applied: Number(row.applied_quantity ?? 0), image: row.image_url || emoji, note: row.description || "동네 청과점에서 정성껏 준비했어요", tag: "이번 주 공동구매", pickup, priceTiers: tiers };
        }));
      } else setCatalog([]);
      setLoading(false);
    });
    const refresh = window.setInterval(() => { void supabase.rpc("weekly_campaign_catalog", { p_pickup_date: pickupDate }).then(({ data }) => {
      if (!active || !data) return;
      setCatalog((current) => current.map((product) => {
        const row = data.find((entry: { product_id: string }) => entry.product_id === product.id) as { applied_quantity: number } | undefined;
        return row ? { ...product, applied: Number(row.applied_quantity) } : product;
      }));
    }); }, 20_000);
    return () => { active = false; window.clearInterval(refresh); };
  }, [pickupDate]);

  function dismissGuidePrompt() {
    window.localStorage.setItem("mapsosa-guide-prompt-dismissed-v1", "1");
    setShowGuidePrompt(false);
  }
  const cartItems = catalog.filter((product) => cart[product.id]);
  const count = cartItems.reduce((sum, product) => sum + cart[product.id], 0);
  const priceForQuantity = (product: Product, quantity: number) => {
    const tiers = product.priceTiers ?? [];
    const totalSlots = product.applied + quantity;
    const tier = [...tiers].reverse().find((entry) => entry.minimumSlots <= totalSlots) ?? tiers[0];
    return tier?.unitPrice ?? product.price;
  };
  const total = cartItems.reduce((sum, product) => sum + priceForQuantity(product, cart[product.id]) * cart[product.id], 0);
  const reservationCartGroups = cartItems.reduce<{ id: string; name: string; address: string; products: Product[] }[]>((groups, product) => {
    const id = product.storeId ?? product.store;
    const store = stores.find((entry) => entry.id === id);
    const group = groups.find((entry) => entry.id === id) ?? { id, name: store?.name ?? product.store, address: store?.address ?? "가게 주소를 확인하지 못했어요.", products: [] };
    if (!groups.includes(group)) groups.push(group);
    group.products.push(product);
    return groups;
  }, []);
  const reservationPickupStores = [...new Map(cartItems.map((product) => {
    const storeId = product.storeId ?? product.store;
    const store = stores.find((entry) => entry.id === storeId);
    return [storeId, { name: store?.name ?? product.store, address: store?.address ?? "가게 주소를 확인하지 못했어요." }] as const;
  })).values()];
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
  const coordinatesByStoreId = useMemo(() => new Map(storeCoordinates.map((coordinate) => [coordinate.id, coordinate])), [storeCoordinates]);
  const visibleStoreCatalog = useMemo(() => {
    if (!nearbySort || !userLocation) return storeCatalog;
    return [...storeCatalog].sort((a, b) => {
      const aCoordinate = coordinatesByStoreId.get(a.id);
      const bCoordinate = coordinatesByStoreId.get(b.id);
      const aDistance = aCoordinate ? distanceMeters(userLocation, aCoordinate) : Number.POSITIVE_INFINITY;
      const bDistance = bCoordinate ? distanceMeters(userLocation, bCoordinate) : Number.POSITIVE_INFINITY;
      return aDistance - bDistance || a.name.localeCompare(b.name, "ko");
    });
  }, [coordinatesByStoreId, nearbySort, storeCatalog, userLocation]);
  const [openStoreId, setOpenStoreId] = useState<string | null>(null);
  const storeDetailsScroller = useRef<HTMLDivElement>(null);
  const storeBottomSheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openStoreId || !storeDetailsScroller.current) return;
    const index = visibleStoreCatalog.findIndex((store) => store.id === openStoreId);
    if (index < 0) return;
    const container = storeDetailsScroller.current;
    const selectedSlide = container.children[index] as HTMLElement | undefined;
    if (selectedSlide) container.style.height = `${selectedSlide.offsetHeight}px`;
    const targetLeft = index * container.clientWidth;
    if (Math.abs(container.scrollLeft - targetLeft) > 4) container.scrollTo({ left: targetLeft });
  }, [openStoreId, visibleStoreCatalog]);
  function selectStoreSlide(event: UIEvent<HTMLDivElement>) {
    const container = event.currentTarget;
    if (!container.clientWidth) return;
    const index = Math.max(0, Math.min(visibleStoreCatalog.length - 1, Math.round(container.scrollLeft / container.clientWidth)));
    const nextStore = visibleStoreCatalog[index];
    if (nextStore && nextStore.id !== openStoreId) {
      setOpenStoreId(nextStore.id);
      const sheet = storeBottomSheet.current;
      if (sheet) {
        const top = container.getBoundingClientRect().top - sheet.getBoundingClientRect().top + sheet.scrollTop - 8;
        sheet.scrollTo({ top: Math.max(0, top) });
      }
    }
  }
  function closeStoreDetails() {
    storeDetailsScroller.current?.style.removeProperty("height");
    if (storeBottomSheet.current) storeBottomSheet.current.scrollTop = 0;
    setOpenStoreId(null);
  }
  const selectedPickupStore = pickupStores.find((store) => store.id === openStoreId) ?? null;
  function toggleNearbySort() {
    if (nearbySort) {
      setNearbySort(false);
      setUserLocation(null);
      setLocationMessage("");
      return;
    }
    if (!navigator.geolocation) {
      setLocationMessage("이 브라우저에서는 현재 위치를 사용할 수 없어요.");
      return;
    }
    setLocating(true);
    setLocationMessage("현재 위치를 확인하고 있어요…");
    navigator.geolocation.getCurrentPosition((position) => {
      setUserLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude });
      setNearbySort(true);
      setLocating(false);
      setLocationMessage("표시 거리는 직선거리이며, 현재 위치는 이 기기에서만 계산해요.");
    }, (error) => {
      setLocating(false);
      setLocationMessage(error.code === error.PERMISSION_DENIED ? "가까운 순 정렬을 하려면 위치 권한을 허용해 주세요." : "현재 위치를 가져오지 못했어요. 다시 시도해 주세요.");
    }, { enableHighAccuracy: false, maximumAge: 60_000, timeout: 12_000 });
  }
  function startSheetDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const market = event.currentTarget.closest(".map-market");
    const sheet = event.currentTarget.closest(".store-bottom-sheet");
    const containerHeight = market?.getBoundingClientRect().height ?? 0;
    if (!sheet || !containerHeight) return;
    const startHeight = sheet.getBoundingClientRect().height / containerHeight * 100;
    sheetDrag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight, containerHeight };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveSheetDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = sheetDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const height = drag.startHeight + (drag.startY - event.clientY) / drag.containerHeight * 100;
    setSheetHeightPercent(Math.max(48, Math.min(88, height)));
  }
  function finishSheetDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = sheetDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const height = Math.max(48, Math.min(88, drag.startHeight + (drag.startY - event.clientY) / drag.containerHeight * 100));
    const snapPoints = [48, 66, 88];
    setSheetHeightPercent(snapPoints.reduce((closest, point) => Math.abs(point - height) < Math.abs(closest - height) ? point : closest, snapPoints[0]));
    sheetDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function handleSheetKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = sheetHeightPercent ?? 66;
    const snapPoints = [48, 66, 88];
    if (event.key === "Home") setSheetHeightPercent(88);
    else if (event.key === "End") setSheetHeightPercent(48);
    else if (event.key === "ArrowUp") setSheetHeightPercent(snapPoints.find((point) => point > current) ?? 88);
    else setSheetHeightPercent([...snapPoints].reverse().find((point) => point < current) ?? 48);
  }
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
  async function reserveProduct(product: Product) {
    const supabase = createClient();
    if (!supabase) { notify("로그인 설정을 확인해 주세요."); return; }
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      setAuthStatus("signed_out");
      setShowLoginPrompt(true);
      return;
    }
    setAuthStatus("signed_in");
    setCurrentUserId(data.user.id);
    changeQuantity(product.id, 1);
    notify(`${product.name}을(를) 담았어요`);
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
    if (deadlineRemaining !== null && deadlineRemaining <= 0) { notify("주문 마감이 지났어요. 페이지를 새로고침해 다음 픽업 날짜를 선택해 주세요."); setShowFinalReservationConfirm(false); return; }
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
        p_refund_preference: "partial",
        p_refund_bank: refundBank,
        p_refund_account: refundAccount,
        p_refund_account_holder: refundHolder,
        p_depositor_name: depositorName,
        p_items: cartItems.map((item) => ({ product_id: item.id, quantity: cart[item.id] })),
      });
      if (error) { notify(error.message); return; }
      setConfirmedOrderTotal(total);
      setConfirmedPickupDate(soonestDate);
      setConfirmedPickupStores(reservationPickupStores);
      setCart({}); setCheckout(false); setShowFinalReservationConfirm(false); setShowPaymentNotice(true);
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
        <div className="day-picker">{pickupOptions.map(({ day, date }) => <button key={date} className={pickupDate === date ? "day-selected" : ""} onClick={() => { setPickupDate(date); closeStoreDetails(); }}><b>{day}</b><small>{formatPickupDate(date)}</small></button>)}</div>
        <div className={`pickup-deadline-countdown${deadlineRemaining !== null && deadlineRemaining <= 0 ? " is-closed" : ""}`} role="timer" aria-label={deadlineRemaining !== null && deadlineRemaining <= 0 ? "선택한 픽업일 주문이 마감되었습니다" : `주문 마감까지 ${deadlineCountdown}`}>
          <span>{deadlineRemaining !== null && deadlineRemaining <= 0 ? "선택한 픽업일 주문" : "주문 마감까지"}</span><b>{deadlineCountdown}</b><small>픽업 전날 오전 10시 마감</small>
        </div>
      </section>

      <section className="mobile-market map-market" style={sheetHeightPercent === null ? undefined : { "--sheet-height": `${sheetHeightPercent}%` } as CSSProperties}>
        <StoreMap variant="background" stores={pickupStores} apiKey={process.env.NEXT_PUBLIC_KAKAO_MAP_KEY} selectedStoreId={openStoreId} onStoreSelect={setOpenStoreId} onLocationsResolved={setStoreCoordinates}/>
        <div className="store-bottom-sheet" ref={storeBottomSheet}>
          <button type="button" className="store-sheet-handle" role="slider" aria-label="가게 목록 창 크기 조절" aria-orientation="vertical" aria-valuemin={48} aria-valuemax={88} aria-valuenow={Math.round(sheetHeightPercent ?? 66)} aria-valuetext={(sheetHeightPercent ?? 66) >= 80 ? "확장" : (sheetHeightPercent ?? 66) <= 52 ? "접힘" : "기본"} onPointerDown={startSheetDrag} onPointerMove={moveSheetDrag} onPointerUp={finishSheetDrag} onPointerCancel={finishSheetDrag} onKeyDown={handleSheetKeyDown}><span/></button>
          <div className="mobile-section-heading"><div><span className="section-kicker">{pickup.toUpperCase()}</span><h2>{pickup} 가게</h2></div><span className="date-chip"><Clock3 size={13}/>{soonestDate}</span></div>
          <div className="store-list-tools"><button type="button" className={`store-sort-button${nearbySort ? " selected" : ""}`} onClick={toggleNearbySort} disabled={locating} aria-pressed={nearbySort}><LocateFixed size={14}/>{locating ? "현재 위치 확인 중…" : nearbySort ? "가까운 순 · 가게명순으로 변경" : "내 위치에서 가까운 순"}</button>{locationMessage && <p role="status">{locationMessage}</p>}</div>
          {selectedPickupStore && <div className="store-map-selected sheet-selected-store"><div><b>{selectedPickupStore.name}</b><span>{selectedPickupStore.address}</span></div><a href={`https://map.kakao.com/link/search/${encodeURIComponent(selectedPickupStore.address)}`} target="_blank" rel="noreferrer">길찾기 <ArrowRight size={14}/></a></div>}
          {loading ? <div className="mobile-empty">가게와 과일을 불러오고 있어요…</div> : visibleStoreCatalog.length ? openStoreId ? <div key="store-details" className="store-detail-carousel" ref={storeDetailsScroller} onScroll={selectStoreSlide} role="region" aria-label="가게 상세 정보, 좌우로 밀어 가게 변경">{visibleStoreCatalog.map((store) => {
          const isOpen = openStoreId === store.id;
          const storeCoordinate = coordinatesByStoreId.get(store.id);
          const distance = nearbySort && userLocation && storeCoordinate ? formatDistance(distanceMeters(userLocation, storeCoordinate)) : null;
          return <article className="pickup-store-card store-detail-slide" key={store.id} aria-current={isOpen ? "true" : undefined}>
            <div className="pickup-store-summary store-detail-heading"><span className="pickup-store-heading"><span><b>{store.name}</b><small><MapPin size={12}/>{store.area}{distance ? ` · ${distance}` : ""} · 과일 {store.products.length}종</small></span><button type="button" className="pickup-store-chevron" onClick={closeStoreDetails}>접기</button></span></div>
            <div className="store-product-details">{store.products.map((product) => {
              const imageIsUrl = isProductImageUrl(product.image);
              const tiers = product.priceTiers ?? [];
              const activeTier = [...tiers].reverse().find((tier) => tier.minimumSlots <= product.applied) ?? tiers[0];
              const nextTier = tiers.find((tier, index) => index > 0 && tier.minimumSlots > product.applied);
              const progressStart = activeTier?.minimumSlots ?? 0;
              const progressSpan = nextTier ? Math.max(1, nextTier.minimumSlots - progressStart) : 1;
              const progressPercent = nextTier ? Math.max(0, Math.min(100, (product.applied - progressStart) / progressSpan * 100)) : product.applied > 0 ? 100 : 0;
              const displayPrice = priceForQuantity(product, cart[product.id] ?? 0);
              return <article className="mobile-product-card" key={product.id}>
                <div className="mobile-product-top"><span className="product-kind">공동구매</span><span className="product-status">모집 중</span><span className="product-deadline">픽업 {soonestDate}</span></div>
                <div className="mobile-product-body"><div className="mobile-product-main"><h3>{product.name} <span>{product.variety}</span></h3><div className="weekly-price-head"><span>{cart[product.id] > 0 ? "선택 수량 기준 입금 단가" : "현재 상품가"}</span><strong>{won(displayPrice)}<small>원 / 상품</small></strong></div><div className="weekly-tier-progress"><div className="weekly-progress-meta"><b>참여 {product.applied.toLocaleString("ko-KR")}슬롯</b><span>{Math.round(progressPercent)}% 진행</span></div><div className="mobile-progress"><span style={{ width: `${progressPercent}%` }}/></div>{nextTier ? <div className="weekly-next-tier"><span>다음 가격 목표</span><b>{nextTier.minimumSlots}슬롯 달성 시 {won(nextTier.unitPrice)}원 / 상품</b><small>{Math.max(0, nextTier.minimumSlots - product.applied)}슬롯 더 모이면 적용돼요</small></div> : <div className="weekly-next-tier complete"><b>최저 가격 구간에 도달했어요</b></div>}<div className="weekly-tier-list" aria-label="가게별 가격 구간">{tiers.map((tier, index) => <span className={activeTier?.minimumSlots === tier.minimumSlots ? "current" : nextTier?.minimumSlots === tier.minimumSlots ? "next" : "future"} key={tier.minimumSlots}><b>{tier.minimumSlots}슬롯{index === tiers.length - 1 ? "+" : "부터"}</b><small>{won(tier.unitPrice)}원</small></span>)}</div></div>{cart[product.id] > 0 && <small className="weekly-cart-price-note">장바구니 수량 포함 예상 단가 · {won(displayPrice)}원 / 상품</small>}</div><div className="mobile-fruit" aria-hidden="true">{imageIsUrl ? <ProductImage image={product.image} fallback="🍎"/> : product.image}</div></div>
                <div className="mobile-product-bottom"><div className="mobile-store"><MapPin size={14}/><b>{product.store}</b><span>· {product.area}</span></div><button className="reserve-button" onClick={() => void reserveProduct(product)}>{cart[product.id] ? `${cart[product.id]}개 담김` : "예약하기"}<Plus size={15}/></button></div>
              </article>;
            })}</div><p className="store-swipe-hint"><ArrowLeftRight size={18} strokeWidth={2.5} aria-hidden="true"/><span>가게를 좌우로 밀어 다른 가게 보기</span></p>
          </article>;
          })}</div> : <div key="store-list" className="pickup-store-list">{visibleStoreCatalog.map((store) => {
          const isOpen = openStoreId === store.id;
          const preview = store.products.slice(0, 3);
          const storeCoordinate = coordinatesByStoreId.get(store.id);
          const distance = nearbySort && userLocation && storeCoordinate ? formatDistance(distanceMeters(userLocation, storeCoordinate)) : null;
          return <article className={`pickup-store-card${isOpen ? " is-open" : ""}`} key={store.id}>
            <button className="pickup-store-summary" aria-expanded={isOpen} onClick={() => { if (!isOpen) track("store_detail_opened", { store_id: store.id }); setOpenStoreId(isOpen ? null : store.id); }}>
              <span className="pickup-store-heading"><span><b>{store.name}</b><small><MapPin size={12}/>{store.area}{distance ? ` · ${distance}` : ""} · 과일 {store.products.length}종</small></span><span className="pickup-store-chevron">{isOpen ? "접기" : "자세히"}<ArrowRight size={15}/></span></span>
              <span className="fruit-preview">{preview.map((product) => <span className="fruit-preview-item" key={product.id}><span className="fruit-preview-image"><ProductImage image={product.image} fallback={product.image}/></span><span className="fruit-preview-copy"><b>{product.name}</b><small>{won(product.price)}원</small></span></span>)}{store.products.length > preview.length && <span className="fruit-preview-more">+{store.products.length - preview.length}</span>}</span>
              <span className="pickup-store-hint">과일을 눌러 상품과 예약 정보를 확인하세요</span>
            </button>
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
      <div className="mobile-cart-items">{reservationCartGroups.map((group) => <section className="cart-store-group" key={group.id}><header><b>{group.name}</b><span>{group.address}</span></header><div>{group.products.map((product) => <div className="mobile-cart-item" key={product.id}><span className="cart-produce"><ProductImage image={product.image} fallback={product.image}/></span><div className="cart-item-copy"><b>{product.name}</b><small>{product.variety} · {won(priceForQuantity(product, cart[product.id]))}원 / 상품</small></div><div className="mobile-quantity"><button onClick={() => changeQuantity(product.id, -1)} aria-label="수량 줄이기"><Minus size={15}/></button><span>{cart[product.id]}</span><button onClick={() => changeQuantity(product.id, 1)} aria-label="수량 늘리기"><Plus size={15}/></button></div></div>)}</div></section>)}</div>
      <div className="mobile-bank-form"><h3>환불 계좌와 입금자 정보</h3><div className="bank-input-grid"><input placeholder="은행명" aria-label="환불 은행명" value={refundBank} onChange={(e) => setRefundBank(e.target.value)}/><input placeholder="계좌번호" aria-label="환불 계좌번호" value={refundAccount} onChange={(e) => setRefundAccount(e.target.value)}/><input placeholder="예금주" aria-label="예금주" value={refundHolder} onChange={(e) => setRefundHolder(e.target.value)}/><input placeholder="입금자명" aria-label="입금자명" value={depositorName} onChange={(e) => setDepositorName(e.target.value)}/></div><p>픽업은 {soonestDate}이며, 주문은 픽업일 전날 오전 10시에 마감됩니다.</p></div>
      <div className="pickup-disposal-notice" role="note"><b>픽업 당일 꼭 수령해 주세요</b><span>당일 찾아가지 않은 상품은 폐기 처리되며, 환불되지 않습니다.</span></div>
      <div className="saved-order-details"><span>{orderDetailsSaved ? "저장된 정보가 다음 주문에 자동으로 입력돼요." : "다음 주문에 다시 쓰려면 정보를 저장해 주세요."}</span><div><button type="button" disabled={savingOrderDetails} onClick={() => void saveOrderDetails()}>{savingOrderDetails ? "저장 중…" : orderDetailsSaved ? "정보 업데이트" : "정보 저장"}</button>{orderDetailsSaved && <button type="button" className="saved-details-delete" disabled={savingOrderDetails} onClick={() => void removeSavedOrderDetails()}>저장 정보 삭제</button>}</div></div>
      <div className="mobile-total"><span>결제 예정 금액</span><b>{won(total)}원</b></div><button className="place-order-button" disabled={submitting || !paymentAccount || (deadlineRemaining !== null && deadlineRemaining <= 0)} onClick={() => setShowFinalReservationConfirm(true)}>{!paymentAccount ? "입금 계좌 설정 대기" : deadlineRemaining !== null && deadlineRemaining <= 0 ? "주문 마감" : "예약하고 입금하기"}<ArrowRight size={17}/></button>
    </section></div>}
    {showFinalReservationConfirm && <div className="mobile-modal-backdrop" onClick={() => setShowFinalReservationConfirm(false)}><section className="login-required-dialog reservation-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reservation-confirm-title" onClick={(event) => event.stopPropagation()}><button className="login-required-close" onClick={() => setShowFinalReservationConfirm(false)} aria-label="닫기"><X size={19}/></button><span className="login-required-icon"><Clock3 size={21}/></span><h2 id="reservation-confirm-title">예약 내용을 확인해 주세요</h2><p>픽업 날짜는 <b>{soonestDate}</b>입니다.<br/>총 {count}개, {won(total)}원으로 예약할까요?</p><div className="reservation-pickup-stores"><b>픽업 가게</b>{reservationPickupStores.map((store) => <div key={store.name}><strong>{store.name}</strong><span>{store.address}</span></div>)}</div><div className="pickup-disposal-notice" role="note"><b>픽업 당일 꼭 수령해 주세요</b><span>당일 찾아가지 않은 상품은 폐기 처리되며, 환불되지 않습니다.</span></div><button className="place-order-button" disabled={submitting || (deadlineRemaining !== null && deadlineRemaining <= 0)} onClick={() => void placeOrder()}>{submitting ? "예약 확정 중…" : deadlineRemaining !== null && deadlineRemaining <= 0 ? "주문 마감" : "확인하기"}<ArrowRight size={17}/></button><button className="reservation-back-button" onClick={() => setShowFinalReservationConfirm(false)}>돌아가서 수정하기</button></section></div>}
    {showPaymentNotice && <div className="mobile-modal-backdrop" onClick={() => { setShowPaymentNotice(false); window.location.assign("/orders"); }}><section className="login-required-dialog payment-notice-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-notice-title" onClick={(event) => event.stopPropagation()}><span className="login-required-icon"><Check size={21}/></span><h2 id="payment-notice-title">예약이 확정됐어요</h2><p>픽업 날짜: <b>{confirmedPickupDate}</b><br/>예약 금액: <b>{won(confirmedOrderTotal)}원</b></p><div className="reservation-pickup-stores"><b>픽업 가게</b>{confirmedPickupStores.map((store) => <div key={store.name}><strong>{store.name}</strong><span>{store.address}</span></div>)}</div><div className="checkout-transfer-account"><b>{paymentAccount?.bank_name} {paymentAccount?.account_number}</b><span>예금주 {paymentAccount?.account_holder}</span>{paymentAccount?.memo && <small>{paymentAccount.memo}</small>}</div><div className="payment-deadline-notice"><b>입금 안내</b><span>주문 후 1시간 안에 입금해 주세요. 시간이 지나도 주문은 자동 취소되지 않으며, 이후 입금은 관리자 확인이 필요해요.</span></div><p>위 계좌로 입금해 주세요. 입금 확인 후 주문 상태가 갱신됩니다.</p><p className="payment-order-ticket-notice">상품 최종 확정과 주문확인서 발급은 픽업일 전날 오후에 진행돼요. 발급된 주문확인서는 픽업할 때 청과점에 보여주세요.</p><p className="weekly-final-price-notice">지금 표시된 가게별 가격 구간으로 입금해 주세요. 마감 후 더 낮은 가격 구간이 적용되면 운영자가 차액을 확인해 별도로 환불합니다.</p><button className="place-order-button" onClick={() => window.location.assign("/orders")}>내 주문 확인하기<ArrowRight size={17}/></button></section></div>}
  </main>;
}
