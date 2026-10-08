"use client";

import { useState } from "react";
import { isProductImageUrl } from "@/lib/products";

export function ProductImage({ image, fallback, className, onLoadError }: { image: string; fallback: string; className?: string; onLoadError?: () => void }) {
  const [failedSource, setFailedSource] = useState("");
  const source = image.trim();
  if (!isProductImageUrl(source) || failedSource === source) return <>{fallback}</>;
  return <img className={className} src={source} alt="" referrerPolicy="no-referrer" onError={() => { setFailedSource(source); onLoadError?.(); }} />;
}
