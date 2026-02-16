"use client";

import { useState, useEffect } from "react";

export function useCountdown(endedAt: Date | string | null | undefined) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    if (!endedAt) return 0;
    return Math.max(0, Math.ceil((new Date(endedAt).getTime() - Date.now()) / 1000));
  });
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!endedAt) {
      setSecondsRemaining(0);
      setInitialized(true);
      return;
    }

    const endTime = new Date(endedAt).getTime();

    function tick() {
      const remaining = Math.max(
        0,
        Math.ceil((endTime - Date.now()) / 1000),
      );
      setSecondsRemaining(remaining);
    }

    tick();
    setInitialized(true);
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endedAt]);

  return {
    secondsRemaining,
    isExpired: initialized && secondsRemaining <= 0,
  };
}
