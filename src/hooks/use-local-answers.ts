"use client";

import { useState, useCallback } from "react";

export interface LocalAnswer {
  text: string;
  normalizedText: string;
}

function storageKey(gameId: number) {
  return `naming-things-answers-${gameId}`;
}

function loadFromStorage(gameId: number): LocalAnswer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(gameId));
    if (!raw) return [];
    return JSON.parse(raw) as LocalAnswer[];
  } catch {
    return [];
  }
}

function saveToStorage(gameId: number, answers: LocalAnswer[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(gameId), JSON.stringify(answers));
}

export function useLocalAnswers(gameId: number) {
  const [answers, setAnswers] = useState<LocalAnswer[]>(() =>
    loadFromStorage(gameId),
  );

  const addAnswer = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const normalizedText = trimmed.toLowerCase();

      // Check for duplicate
      const isDuplicate = answers.some(
        (a) => a.normalizedText === normalizedText,
      );
      if (isDuplicate) return false;

      const newAnswer: LocalAnswer = { text: trimmed, normalizedText };
      const updated = [...answers, newAnswer];
      setAnswers(updated);
      saveToStorage(gameId, updated);
      return true;
    },
    [answers, gameId],
  );

  const clearAnswers = useCallback(() => {
    setAnswers([]);
    if (typeof window !== "undefined") {
      localStorage.removeItem(storageKey(gameId));
    }
  }, [gameId]);

  return { answers, addAnswer, clearAnswers };
}
