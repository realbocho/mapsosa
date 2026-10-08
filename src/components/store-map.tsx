"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, MapPin } from "lucide-react";

export type StoreLocation = { id: string; name: string; area: string; address: string };

type LatLng = object;
type KakaoMap = { setBounds: (bounds: object) => void; jump: (position: LatLng, level: number, options?: { animate?: boolean }) => void };
type KakaoMarker = object;
type GeocodeResult = { x: string; y: string };
type KakaoApi = {
  maps: {
    load: (callback: () => void) => void;
    LatLng: new (latitude: number, longitude: number) => LatLng;
    LatLngBounds: new () => { extend: (position: LatLng) => void };
    Map: new (element: HTMLElement, options: { center: LatLng; level: number }) => KakaoMap;
    Marker: new (options: { map: KakaoMap; position: LatLng }) => KakaoMarker;
    services: {
      Geocoder: new () => { addressSearch: (address: string, callback: (results: GeocodeResult[], status: string) => void, options?: { analyze_type?: string }) => void };
      Status: { OK: string };
    };
    event: { addListener: (target: object, event: string, callback: () => void) => void };
  };
};

declare global {
  interface Window { kakao?: KakaoApi }
}

let kakaoMapScript: Promise<KakaoApi> | undefined;

function loadKakaoMap(key: string): Promise<KakaoApi> {
  if (window.kakao?.maps.services) return Promise.resolve(window.kakao);
  if (kakaoMapScript) return kakaoMapScript;

  kakaoMapScript = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`;
    script.async = true;
    script.onload = () => {
      if (!window.kakao) { reject(new Error("Kakao Maps SDK did not initialize")); return; }
      window.kakao.maps.load(() => window.kakao ? resolve(window.kakao) : reject(new Error("Kakao Maps SDK is unavailable")));
    };
    script.onerror = () => reject(new Error("Kakao Maps SDK failed to load"));
    document.head.appendChild(script);
  });
  return kakaoMapScript;
}

export function StoreMap({ stores, apiKey, selectedStoreId, variant = "default", onStoreSelect }: { stores: StoreLocation[]; apiKey?: string; selectedStoreId?: string | null; variant?: "default" | "background"; onStoreSelect?: (storeId: string) => void }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const markersReady = useRef(false);
  const boundsFitFallback = useRef<number | undefined>(undefined);
  const markerPositions = useRef(new Map<string, LatLng>());
  const [selectedStore, setSelectedStore] = useState<StoreLocation | null>(null);
  const [mapError, setMapError] = useState<"sdk" | "address" | null>(null);
  const [unlocatedCount, setUnlocatedCount] = useState(0);
  const [markersVersion, setMarkersVersion] = useState(0);

  useEffect(() => {
    if (!apiKey || !mapElement.current || stores.length === 0) return;
    markersReady.current = false;
    let cancelled = false;
    void loadKakaoMap(apiKey).then((kakao) => {
      if (cancelled || !mapElement.current) return;
      const map = new kakao.maps.Map(mapElement.current, {
        center: new kakao.maps.LatLng(37.5665, 126.978),
        level: 7,
      });
      mapRef.current = map;
      const geocoder = new kakao.maps.services.Geocoder();
      const bounds = new kakao.maps.LatLngBounds();
      let completed = 0;
      let located = 0;
      let boundsFitPending = false;

      function finishStore(store: StoreLocation, x?: string, y?: string) {
        if (cancelled) return;
        if (x && y) {
          const position = new kakao.maps.LatLng(Number(y), Number(x));
          const marker = new kakao.maps.Marker({ map, position });
          markerPositions.current.set(store.id, position);
          bounds.extend(position);
          located += 1;
          kakao.maps.event.addListener(marker, "click", () => {
            setSelectedStore(store);
            onStoreSelect?.(store.id);
            map.jump(position, 3, { animate: false });
          });
        }
        completed += 1;
        if (completed === stores.length && located > 0) {
          boundsFitPending = true;
          kakao.maps.event.addListener(map, "idle", () => {
            if (!boundsFitPending || cancelled) return;
            boundsFitPending = false;
            markersReady.current = true;
            if (boundsFitFallback.current !== undefined) window.clearTimeout(boundsFitFallback.current);
            setMarkersVersion((version) => version + 1);
          });
          map.setBounds(bounds);
          setUnlocatedCount(stores.length - located);
          boundsFitFallback.current = window.setTimeout(() => {
            if (!boundsFitPending || cancelled) return;
            boundsFitPending = false;
            markersReady.current = true;
            setMarkersVersion((version) => version + 1);
          }, 700);
        }
        if (completed === stores.length && located === 0) {
          setMapError("address");
          markersReady.current = true;
          setMarkersVersion((version) => version + 1);
        }
      }

      for (const store of stores) {
        geocoder.addressSearch(store.address, (results, status) => {
          if (cancelled) return;
          const result = status === kakao.maps.services.Status.OK ? results[0] : undefined;
          finishStore(store, result?.x, result?.y);
        });
      }
    }).catch(() => { if (!cancelled) setMapError("sdk"); });

    return () => {
      cancelled = true;
      markersReady.current = false;
      if (boundsFitFallback.current !== undefined) window.clearTimeout(boundsFitFallback.current);
      boundsFitFallback.current = undefined;
      mapRef.current = null;
      markerPositions.current.clear();
    };
  }, [apiKey, onStoreSelect, stores]);

  useEffect(() => {
    if (!selectedStoreId) {
      setSelectedStore(null);
      return;
    }
    const store = stores.find((entry) => entry.id === selectedStoreId);
    const position = markerPositions.current.get(selectedStoreId);
    if (!store || !position || !mapRef.current || !markersReady.current) return;
    setSelectedStore(store);
    mapRef.current.jump(position, 3, { animate: false });
  }, [selectedStoreId, stores, markersVersion]);

  function focusStore(store: StoreLocation) {
    const position = markerPositions.current.get(store.id);
    if (position) {
      mapRef.current?.jump(position, 3, { animate: false });
    }
    setSelectedStore(store);
    onStoreSelect?.(store.id);
  }

  return <section className={`store-map-section${variant === "background" ? " store-map-background" : ""}`} aria-labelledby="store-map-title">
    {variant === "default" && <div className="store-map-heading">
      <div><span className="section-kicker">NEAR YOUR NEIGHBORHOOD</span><h2 id="store-map-title">가게 위치</h2></div>
      <span className="store-map-count"><MapPin size={13}/>{stores.length}곳</span>
    </div>}
    {variant === "background" && <div className="store-map-background-heading"><MapPin size={14}/>가게 위치 <span>{stores.length}곳</span></div>}
    {stores.length === 0 ? <div className="store-map-empty">등록된 가게가 아직 없어요.</div> : <>
      <div className="store-map-canvas" ref={mapElement} aria-label="등록된 청과점 위치 지도">
        {!apiKey && <div className="store-map-message">지도를 준비하고 있어요.</div>}
        {mapError === "sdk" && <div className="store-map-message">지도를 불러오지 못했어요. Kakao Developers에서 JavaScript 키와 사이트 도메인 설정을 확인해 주세요.</div>}
        {mapError === "address" && <div className="store-map-message">등록된 가게 주소에서 지도 위치를 찾지 못했어요. 주소를 도로명 주소로 확인해 주세요.</div>}
        {!mapError && unlocatedCount > 0 && <div className="store-map-message">{unlocatedCount}개 가게의 주소를 지도에서 찾지 못했어요. 주소를 확인해 주세요.</div>}
      </div>
      {variant === "default" && <div className="store-map-list">{stores.map((store) => <button key={store.id} className={selectedStore?.id === store.id ? "store-map-chip selected" : "store-map-chip"} onClick={() => focusStore(store)}><MapPin size={13}/><span>{store.name}</span></button>)}</div>}
      {variant === "default" && selectedStore && <div className="store-map-selected"><div><b>{selectedStore.name}</b><span>{selectedStore.address}</span></div><a href={`https://map.kakao.com/link/search/${encodeURIComponent(`${selectedStore.name} ${selectedStore.address}`)}`} target="_blank" rel="noreferrer">길찾기 <ArrowUpRight size={14}/></a></div>}
    </>}
  </section>;
}
