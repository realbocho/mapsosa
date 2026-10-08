"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, MapPin } from "lucide-react";

export type StoreLocation = { id: string; name: string; area: string; address: string };

type LatLng = object;
type KakaoMap = { panTo: (position: LatLng) => void; setBounds: (bounds: object) => void };
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
      Geocoder: new () => { addressSearch: (address: string, callback: (results: GeocodeResult[], status: string) => void) => void };
      Status: { OK: string };
    };
    event: { addListener: (target: KakaoMarker, event: string, callback: () => void) => void };
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

export function StoreMap({ stores, apiKey }: { stores: StoreLocation[]; apiKey?: string }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const markerPositions = useRef(new Map<string, LatLng>());
  const [selectedStore, setSelectedStore] = useState<StoreLocation | null>(null);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    if (!apiKey || !mapElement.current || stores.length === 0) return;
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

      for (const store of stores) {
        geocoder.addressSearch(store.address, (results, status) => {
          if (cancelled) return;
          const result = status === kakao.maps.services.Status.OK ? results[0] : undefined;
          if (result) {
            const position = new kakao.maps.LatLng(Number(result.y), Number(result.x));
            const marker = new kakao.maps.Marker({ map, position });
            markerPositions.current.set(store.id, position);
            bounds.extend(position);
            located += 1;
            kakao.maps.event.addListener(marker, "click", () => {
              setSelectedStore(store);
              map.panTo(position);
            });
          }

          completed += 1;
          if (completed === stores.length && located > 0) map.setBounds(bounds);
          if (completed === stores.length && located === 0) setMapError(true);
        });
      }
    }).catch(() => { if (!cancelled) setMapError(true); });

    return () => {
      cancelled = true;
      mapRef.current = null;
      markerPositions.current.clear();
    };
  }, [apiKey, stores]);

  function focusStore(store: StoreLocation) {
    const position = markerPositions.current.get(store.id);
    if (position) mapRef.current?.panTo(position);
    setSelectedStore(store);
  }

  return <section className="store-map-section" aria-labelledby="store-map-title">
    <div className="store-map-heading">
      <div><span className="section-kicker">NEAR YOUR NEIGHBORHOOD</span><h2 id="store-map-title">가게 위치</h2></div>
      <span className="store-map-count"><MapPin size={13}/>{stores.length}곳</span>
    </div>
    {stores.length === 0 ? <div className="store-map-empty">등록된 가게가 아직 없어요.</div> : <>
      <div className="store-map-canvas" ref={mapElement} aria-label="등록된 청과점 위치 지도">
        {!apiKey && <div className="store-map-message">지도를 준비하고 있어요.</div>}
        {mapError && <div className="store-map-message">주소를 지도에서 찾지 못했어요. 관리자에게 가게 주소를 확인해 주세요.</div>}
      </div>
      <div className="store-map-list">{stores.map((store) => <button key={store.id} className={selectedStore?.id === store.id ? "store-map-chip selected" : "store-map-chip"} onClick={() => focusStore(store)}><MapPin size={13}/><span>{store.name}</span></button>)}</div>
      {selectedStore && <div className="store-map-selected"><div><b>{selectedStore.name}</b><span>{selectedStore.address}</span></div><a href={`https://map.kakao.com/link/search/${encodeURIComponent(`${selectedStore.name} ${selectedStore.address}`)}`} target="_blank" rel="noreferrer">길찾기 <ArrowUpRight size={14}/></a></div>}
    </>}
  </section>;
}
