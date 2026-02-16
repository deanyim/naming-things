"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "~/trpc/react";

function getOrCreateSessionToken(): string {
  if (typeof window === "undefined") return "";
  let token = localStorage.getItem("naming-things-session");
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem("naming-things-session", token);
  }
  return token;
}

export function useSession() {
  const [sessionToken, setSessionToken] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>("");

  useEffect(() => {
    setSessionToken(getOrCreateSessionToken());
    const saved = localStorage.getItem("naming-things-display-name");
    if (saved) setDisplayName(saved);
  }, []);

  const ensureSession = api.player.ensureSession.useMutation();

  const login = useCallback(
    async (name: string) => {
      const token = getOrCreateSessionToken();
      setSessionToken(token);
      setDisplayName(name);
      localStorage.setItem("naming-things-display-name", name);
      const player = await ensureSession.mutateAsync({
        sessionToken: token,
        displayName: name,
      });
      return player;
    },
    [ensureSession],
  );

  return {
    sessionToken,
    displayName,
    setDisplayName,
    login,
    isReady: sessionToken !== "",
  };
}
