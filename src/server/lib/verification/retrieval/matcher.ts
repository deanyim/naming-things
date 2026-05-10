import type {
  CategoryEvidencePacket,
  CanonicalEntry,
  EvidenceFact,
} from "../types";
import { normalizeMatchText } from "./extractor";

export type DatasetJudgmentResult = {
  status: "valid" | "invalid" | "ambiguous" | "needs_lookup";
  submitted: string;
  normalizedSubmitted: string;
  canonical?: string;
  matchedEntry?: CanonicalEntry | EvidenceFact;
  candidates?: (CanonicalEntry | EvidenceFact)[];
  confidence: number;
  explanation: string;
};

export type DatasetLookupCandidate = {
  canonical: string;
  aliases: string[];
  matchKeys: string[];
};

export type DatasetLookupHint = {
  submitted: string;
  normalizedSubmitted: string;
  candidates: DatasetLookupCandidate[];
  reason: string;
};

function aliasValues(fact: EvidenceFact) {
  return fact.aliases ?? [];
}

function compactSpaces(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function derivedNameKeys(value: string) {
  const keys = new Set<string>();
  const normalized = normalizeMatchText(value);
  if (normalized) keys.add(normalized);

  const withoutParentheticals = normalizeMatchText(
    value.replace(/\([^)]*\)/g, " "),
  );
  if (withoutParentheticals) keys.add(withoutParentheticals);

  const quotedNicknameMatch = value.match(
    /^([^"“”]+?)\s+["“”]([^"“”]+)["“”]\s+(.+)$/,
  );
  if (quotedNicknameMatch) {
    const first = quotedNicknameMatch[1] ?? "";
    const nickname = quotedNicknameMatch[2] ?? "";
    const rest = quotedNicknameMatch[3] ?? "";
    const legalName = normalizeMatchText(`${first} ${rest}`);
    const nicknameName = normalizeMatchText(`${nickname} ${rest}`);
    if (legalName) keys.add(legalName);
    if (nicknameName) keys.add(nicknameName);
  }

  if (
    keys.has("rob mariano") ||
    (normalized.includes("rob") && normalized.includes("mariano"))
  ) {
    keys.add("boston rob");
  }

  return Array.from(keys);
}

function matchKeysForFact(fact: EvidenceFact) {
  return Array.from(
    new Set([
      ...derivedNameKeys(fact.canonicalAnswer),
      ...(fact.matchKeys ?? []),
      ...aliasValues(fact).flatMap((alias) => derivedNameKeys(alias)),
    ].filter(Boolean)),
  );
}

function getDatasetConfidence(packet: CategoryEvidencePacket) {
  const confidence = packet.facts.find((fact) => fact.metadata?.datasetConfidence)
    ?.metadata?.datasetConfidence;
  if (confidence === "high" || confidence === "medium" || confidence === "low") {
    return confidence;
  }
  return packet.status === "ready" && packet.facts.length >= 20 ? "high" : "medium";
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }

  return prev[b.length]!;
}

function fuzzyThreshold(value: string) {
  if (value.length < 5) return 0;
  if (value.length < 10) return 1;
  return 2;
}

function weakFuzzyThreshold(value: string) {
  if (value.length < 4) return 0;
  if (value.length < 7) return 1;
  if (value.length < 12) return 2;
  return 3;
}

function uniqueFacts(facts: EvidenceFact[]) {
  return Array.from(
    new Map(facts.map((fact) => [fact.canonicalAnswer, fact])).values(),
  );
}

function tokenPrefixMatches(
  normalizedSubmitted: string,
  entries: { fact: EvidenceFact; keys: string[] }[],
) {
  const submittedTokens = normalizedSubmitted.split(" ").filter(Boolean);
  if (submittedTokens.length === 0) return [];

  const exactTokenMatches: EvidenceFact[] = [];
  const prefixMatches: EvidenceFact[] = [];
  for (const entry of entries) {
    const exactTokenMatched = entry.keys.some((key) =>
      key.split(" ").filter(Boolean).includes(normalizedSubmitted),
    );
    if (exactTokenMatched) {
      exactTokenMatches.push(entry.fact);
      continue;
    }

    const prefixMatched = entry.keys.some((key) => {
      const keyTokens = key.split(" ").filter(Boolean);
      if (submittedTokens.length < 2) return false;
      if (submittedTokens.length > keyTokens.length) return false;

      return submittedTokens.every((submittedToken, index) => {
        const keyToken = keyTokens[index];
        if (!keyToken) return false;
        if (submittedToken.length === 1) {
          return keyToken.startsWith(submittedToken);
        }
        return keyToken.startsWith(submittedToken);
      });
    });

    if (prefixMatched) prefixMatches.push(entry.fact);
  }

  const exactTokenFacts = uniqueFacts(exactTokenMatches);
  return exactTokenFacts.length > 0 ? exactTokenFacts : uniqueFacts(prefixMatches);
}

function weakCandidateMatches(
  normalizedSubmitted: string,
  entries: { fact: EvidenceFact; keys: string[] }[],
) {
  const matches: EvidenceFact[] = [];

  for (const entry of entries) {
    const matched = entry.keys.some((key) => {
      const keyTokens = key.split(" ").filter(Boolean);
      if (!key) return false;

      if (normalizedSubmitted.length >= 4) {
        const primaryToken = keyTokens[0] ?? key;
        const threshold = weakFuzzyThreshold(primaryToken);
        if (
          threshold > 0 &&
          !primaryToken.startsWith(normalizedSubmitted) &&
          Math.abs(primaryToken.length - normalizedSubmitted.length) <= threshold &&
          normalizedSubmitted.length >= primaryToken.length - 1 &&
          levenshtein(normalizedSubmitted, primaryToken) <= threshold
        ) {
          return true;
        }
      }

      return false;
    });

    if (matched) matches.push(entry.fact);
  }

  return uniqueFacts(matches).slice(0, 12);
}

export function makeLookupHintCandidate(fact: EvidenceFact): DatasetLookupCandidate {
  return {
    canonical: fact.canonicalAnswer,
    aliases: aliasValues(fact).slice(0, 5),
    matchKeys: matchKeysForFact(fact).slice(0, 8),
  };
}

export function buildDatasetLookupHint(
  packet: CategoryEvidencePacket,
  submitted: string,
): DatasetLookupHint | null {
  if (packet.status !== "ready" || packet.facts.length === 0) return null;

  const normalizedSubmitted = normalizeMatchText(submitted);
  const entries = packet.facts.map((fact) => ({
    fact,
    keys: matchKeysForFact(fact),
  }));
  const candidates = weakCandidateMatches(normalizedSubmitted, entries);

  if (candidates.length === 0) return null;

  return {
    submitted,
    normalizedSubmitted,
    candidates: candidates.map(makeLookupHintCandidate),
    reason:
      "Deterministic matcher did not find an authoritative match, but these dataset entries are plausible candidates.",
  };
}

export function judgeAnswerWithDataset(
  packet: CategoryEvidencePacket,
  submitted: string,
): DatasetJudgmentResult {
  const normalizedSubmitted = normalizeMatchText(submitted);
  const confidence = getDatasetConfidence(packet);

  if (packet.status !== "ready" || packet.facts.length === 0) {
    return {
      status: "needs_lookup",
      submitted,
      normalizedSubmitted,
      confidence: 0.2,
      explanation: "No ready dataset is available for authoritative matching.",
    };
  }

  const index = new Map<string, EvidenceFact[]>();
  const entries: { fact: EvidenceFact; keys: string[] }[] = [];
  for (const fact of packet.facts) {
    const keys = matchKeysForFact(fact);
    entries.push({ fact, keys });
    for (const key of keys) {
      const bucket = index.get(key) ?? [];
      bucket.push(fact);
      index.set(key, bucket);
    }
  }

  const exact = index.get(normalizedSubmitted) ?? [];
  if (exact.length === 1) {
    return {
      status: "valid",
      submitted,
      normalizedSubmitted,
      canonical: exact[0]!.canonicalAnswer,
      matchedEntry: exact[0],
      confidence: 1,
      explanation: `Matched canonical dataset entry "${exact[0]!.canonicalAnswer}".`,
    };
  }
  if (exact.length > 1) {
    return {
      status: "ambiguous",
      submitted,
      normalizedSubmitted,
      candidates: exact,
      confidence: 0.8,
      explanation: "Submitted answer matches multiple dataset entries.",
    };
  }

  let fuzzyMatches: EvidenceFact[] = [];
  for (const [key, facts] of index.entries()) {
    const threshold = fuzzyThreshold(key);
    if (threshold === 0) continue;
    if (Math.abs(key.length - normalizedSubmitted.length) > threshold) continue;
    if (levenshtein(normalizedSubmitted, key) <= threshold) {
      fuzzyMatches = fuzzyMatches.concat(facts);
    }
  }
  fuzzyMatches = uniqueFacts(fuzzyMatches);

  if (fuzzyMatches.length === 1) {
    return {
      status: "valid",
      submitted,
      normalizedSubmitted,
      canonical: fuzzyMatches[0]!.canonicalAnswer,
      matchedEntry: fuzzyMatches[0],
      confidence: 0.86,
      explanation: `Conservative fuzzy match to "${fuzzyMatches[0]!.canonicalAnswer}".`,
    };
  }
  if (fuzzyMatches.length > 1) {
    return {
      status: "ambiguous",
      submitted,
      normalizedSubmitted,
      candidates: fuzzyMatches,
      confidence: 0.7,
      explanation: "Submitted answer is close to multiple dataset entries.",
    };
  }

  const prefixMatches = tokenPrefixMatches(normalizedSubmitted, entries);
  if (prefixMatches.length === 1) {
    return {
      status: "valid",
      submitted,
      normalizedSubmitted,
      canonical: prefixMatches[0]!.canonicalAnswer,
      matchedEntry: prefixMatches[0],
      confidence: 0.9,
      explanation: `Unique prefix match to "${prefixMatches[0]!.canonicalAnswer}".`,
    };
  }
  if (prefixMatches.length > 1) {
    return {
      status: "ambiguous",
      submitted,
      normalizedSubmitted,
      candidates: prefixMatches,
      confidence: 0.72,
      explanation: `Prefix matches multiple dataset entries: ${prefixMatches
        .slice(0, 5)
        .map((fact) => compactSpaces(fact.canonicalAnswer))
        .join(", ")}.`,
    };
  }

  const weakMatches = weakCandidateMatches(normalizedSubmitted, entries);
  if (weakMatches.length > 0) {
    return {
      status: "needs_lookup",
      submitted,
      normalizedSubmitted,
      candidates: weakMatches,
      confidence: 0.5,
      explanation:
        "Dataset has plausible weak candidates; ask the LLM to decide from the shortlist.",
    };
  }

  if (confidence === "high") {
    return {
      status: "invalid",
      submitted,
      normalizedSubmitted,
      confidence: 0.92,
      explanation: "No exact, alias, or conservative fuzzy match in a high-confidence dataset.",
    };
  }

  return {
    status: "needs_lookup",
    submitted,
    normalizedSubmitted,
    confidence: confidence === "medium" ? 0.55 : 0.35,
    explanation: "Dataset did not match and is not high-confidence enough for authoritative rejection.",
  };
}
