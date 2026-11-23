"use client";

import { useEffect, useState } from "react";
import { loadProviderPrefs } from "@/lib/provider-prefs";
import {
  MODEL_OPTIONS,
  orderedModelOptions,
  type ModelOption,
  type ProviderId,
} from "@/lib/providers";

/**
 * Model picker ordered by the default channel chosen on Connections.
 * `emptyLabel` adds a first option with an empty value.
 */
export function ModelSelect({
  value,
  onChange,
  emptyLabel,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  emptyLabel?: string;
  id?: string;
}) {
  const [provider, setProvider] = useState<ProviderId | null>(null);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setProvider(loadProviderPrefs().defaultProvider);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const options: ModelOption[] = provider ? orderedModelOptions(provider) : MODEL_OPTIONS;
  const known = !value || options.some((m) => m.ref === value);

  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : null}
      {known ? null : <option value={value}>{value}</option>}
      {options.map((model) => (
        <option key={model.ref} value={model.ref}>
          {model.label} · {model.provider}
        </option>
      ))}
    </select>
  );
}
