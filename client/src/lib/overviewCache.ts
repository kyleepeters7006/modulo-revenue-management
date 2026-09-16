type StoredOverviewValue<T> = {
  data: T;
  updatedAt: number;
};

const CACHE_PREFIX = "modulo:overview:last-success:v1";

function storageKey(clientId: string, slot: string) {
  return `${CACHE_PREFIX}:${clientId || "demo"}:${slot}`;
}

export function readOverviewCache<T>(
  clientId: string,
  slot: string,
): StoredOverviewValue<T> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey(clientId, slot));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredOverviewValue<T>>;
    if (
      parsed.data === undefined ||
      typeof parsed.updatedAt !== "number" ||
      !Number.isFinite(parsed.updatedAt)
    ) {
      window.localStorage.removeItem(storageKey(clientId, slot));
      return undefined;
    }
    return { data: parsed.data as T, updatedAt: parsed.updatedAt };
  } catch {
    return undefined;
  }
}

export function writeOverviewCache<T>(clientId: string, slot: string, data: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(clientId, slot),
      JSON.stringify({ data, updatedAt: Date.now() } satisfies StoredOverviewValue<T>),
    );
  } catch {
    // Browser storage is an optimization. The live query remains authoritative.
  }
}