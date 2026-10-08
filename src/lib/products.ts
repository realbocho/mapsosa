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

// Production catalog is populated by operators through /admin.
export const products: Product[] = [];

export const won = (value: number) => new Intl.NumberFormat("ko-KR").format(value);

