export type Product = {
  id: string;
  storeId?: string;
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

export function isProductImageUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const won = (value: number) => new Intl.NumberFormat("ko-KR").format(value);
