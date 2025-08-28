// components/UKDate.tsx
"use client";
import { formatDateUK, formatDateTimeUK } from "@/lib/dates";

export function UKDate({ value }: { value: Date | string | number }) {
  const iso = new Date(value).toISOString();
  return <time dateTime={iso}>{formatDateUK(value)}</time>;
}

export function UKDateTime({ value }: { value: Date | string | number }) {
  const iso = new Date(value).toISOString();
  return <time dateTime={iso}>{formatDateTimeUK(value)}</time>;
}
