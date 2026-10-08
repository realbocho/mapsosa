export type Product = {
  id: string;
  name: string;
  variety: string;
  store: string;
  area: string;
  price: number;
  oldPrice: number;
  unit: string;
  type: "slot" | "instant";
  slotSize?: number;
  applied: number;
  image: string;
  note: string;
  tag: string;
  pickup: string;
};

export const products: Product[] = [
  { id: "p1", name: "아삭한 햇사과", variety: "부사 · 2kg", store: "청과상회", area: "망원시장", price: 12900, oldPrice: 15900, unit: "2kg", type: "slot", slotSize: 4, applied: 11, image: "🍎", note: "산지에서 바로 올라온 단단한 부사", tag: "이번 주 인기", pickup: "수요일" },
  { id: "p2", name: "샤인머스캣", variety: "특품 · 1송이", store: "과일연구소", area: "연남동", price: 8900, oldPrice: 11900, unit: "1송이", type: "instant", applied: 0, image: "🍇", note: "알이 굵고 향이 진한 특품", tag: "바로 주문", pickup: "수요일" },
  { id: "p3", name: "제주 한라봉", variety: "중과 · 3kg", store: "탐라청과", area: "합정시장", price: 18900, oldPrice: 22900, unit: "3kg", type: "slot", slotSize: 6, applied: 24, image: "🍊", note: "새콤달콤 과즙 가득, 가정용 선물용 모두 좋아요", tag: "3,000원 절약", pickup: "토요일" },
  { id: "p4", name: "완숙 찰토마토", variety: "중량 · 2kg", store: "초록바구니", area: "망원시장", price: 9900, oldPrice: 12900, unit: "2kg", type: "instant", applied: 0, image: "🍅", note: "햇살 아래 천천히 익힌 완숙 토마토", tag: "오늘 마감", pickup: "토요일" },
  { id: "p5", name: "달콤한 골드키위", variety: "점보 · 8입", store: "과일연구소", area: "연남동", price: 10900, oldPrice: 13900, unit: "8입", type: "slot", slotSize: 5, applied: 18, image: "🥝", note: "후숙 없이 바로 먹는 달콤한 골드키위", tag: "산지직송", pickup: "수요일" },
  { id: "p6", name: "새콤달콤 딸기", variety: "금실 · 500g", store: "청과상회", area: "망원시장", price: 7900, oldPrice: 9900, unit: "500g", type: "instant", applied: 0, image: "🍓", note: "향긋하고 단단한 제철 금실 딸기", tag: "제철 과일", pickup: "토요일" },
];

export const won = (value: number) => new Intl.NumberFormat("ko-KR").format(value);
