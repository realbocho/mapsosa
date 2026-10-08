export function orderUpdatesSeenKey(userId: string) {
  return `mapsosa-order-updates-seen-v1:${userId}`;
}

export function newestOrderUpdate(orders: { updated_at?: string | null }[]) {
  return orders.reduce((latest, order) => {
    const updatedAt = order.updated_at ?? "";
    return updatedAt > latest ? updatedAt : latest;
  }, "");
}
