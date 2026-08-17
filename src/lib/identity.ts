import { newId } from "./id";

export type PrismUser = {
  id: string;
  name: string;
  /** Last sign-in / activity timestamp */
  updatedAt: number;
};

const USER_KEY = "prism.user.v1";

export function defaultUser(): PrismUser {
  return {
    id: newId(),
    name: "Local builder",
    updatedAt: Date.now(),
  };
}

export function loadUser(): PrismUser {
  if (typeof window === "undefined") return defaultUser();
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) {
      const user = defaultUser();
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      return user;
    }
    const parsed = JSON.parse(raw) as PrismUser;
    if (!parsed?.id || !parsed?.name) return defaultUser();
    return parsed;
  } catch {
    return defaultUser();
  }
}

export function saveUser(user: PrismUser) {
  if (typeof window === "undefined") return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** Touch last-active time (stand-in for “last sign-in” until real auth). */
export function touchUser(user: PrismUser): PrismUser {
  const next = { ...user, updatedAt: Date.now() };
  saveUser(next);
  return next;
}

export function renameUser(user: PrismUser, name: string): PrismUser {
  const trimmed = name.trim() || user.name;
  const next = { ...user, name: trimmed, updatedAt: Date.now() };
  saveUser(next);
  return next;
}
