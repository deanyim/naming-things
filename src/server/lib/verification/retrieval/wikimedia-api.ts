const DEFAULT_WIKIMEDIA_USER_AGENT =
  "naming-things/0.1 (https://github.com/openai/naming-things)";

export const WIKIMEDIA_MAXLAG_SECONDS = 5;

export function wikimediaHeaders(accept = "application/json") {
  const userAgent =
    process.env.WIKIMEDIA_USER_AGENT ?? DEFAULT_WIKIMEDIA_USER_AGENT;

  return {
    "User-Agent": userAgent,
    "Api-User-Agent": userAgent,
    "Accept-Encoding": "gzip",
    Accept: accept,
  };
}

export function addWikimediaReadParams(apiUrl: URL) {
  apiUrl.searchParams.set("format", "json");
  apiUrl.searchParams.set("formatversion", "2");
  apiUrl.searchParams.set("maxlag", String(WIKIMEDIA_MAXLAG_SECONDS));
}

function retryDelayMs(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  return 500 * 2 ** attempt;
}

async function delay(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWikimediaApi(
  apiUrl: URL,
  options: { attempts?: number } = {},
) {
  const attempts = options.attempts ?? 3;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(apiUrl, {
      headers: wikimediaHeaders(),
    });
    lastResponse = response;

    if (response.ok) return response;

    if (
      attempt < attempts - 1 &&
      (response.status === 429 || response.status === 503)
    ) {
      await delay(retryDelayMs(response, attempt));
      continue;
    }

    return response;
  }

  return lastResponse;
}
