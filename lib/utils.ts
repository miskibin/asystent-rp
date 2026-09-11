import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatNumber = (num: number): string =>
  num >= 1000 ? `${(num / 1000).toFixed(1)}k` : num.toString();
