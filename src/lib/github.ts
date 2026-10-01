/**
 * GitHub API client for browser use with strict CORS rules and retry logic.
 */

export interface ApiResult {
  ok: boolean;
  status: number;
  headers: Headers | null;
  data: unknown;
  blob: Blob | null;
  errorMessage: string | null;
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  noAuth?: boolean;
  asBlob?: boolean;
}

export async function apiFetch(path: string, options?: ApiFetchOptions): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (!options?.asBlob) {
    headers['Accept'] = 'application/vnd.github+json';
  }
  if (options?.token && !options?.noAuth) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  if (options?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const fetchOptions: RequestInit = {
    method: options?.method || 'GET',
    headers,
  };
  if (options?.body !== undefined) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  for (let attempt = 0; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let response: Response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        ...fetchOptions,
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      if (controller.signal.aborted) {
        return {
          ok: false,
          status: 0,
          headers: null,
          data: null,
          blob: null,
          errorMessage: 'Request timed out after 30 seconds.',
        };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: 0,
        headers: null,
        data: null,
        blob: null,
        errorMessage: `Network error: ${msg}`,
      };
    }
    clearTimeout(timeoutId);

    // If asBlob is requested and response is ok (status 200..299)
    if (options?.asBlob && response.ok) {
      try {
        const blob = await response.blob();
        return {
          ok: true,
          status: response.status,
          headers: response.headers,
          data: null,
          blob,
          errorMessage: null,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          status: response.status,
          headers: response.headers,
          data: null,
          blob: null,
          errorMessage: `Network error: ${msg}`,
        };
      }
    }

    // Parse JSON or text
    let jsonData: unknown = null;
    try {
      const textBody = await response.text();
      if (textBody.trim()) {
        jsonData = JSON.parse(textBody);
      }
    } catch {
      jsonData = null;
    }

    // Check retry conditions:
    // 502 or 503, OR 403/429 with JSON "message" containing "rate limit" (case-insensitive)
    const is502or503 = response.status === 502 || response.status === 503;
    let isRateLimitMsg = false;
    if (response.status === 403 || response.status === 429) {
      if (jsonData && typeof jsonData === 'object' && 'message' in jsonData) {
        const msg = String((jsonData as { message?: unknown }).message || '');
        if (/rate limit/i.test(msg)) {
          isRateLimitMsg = true;
        }
      }
    }

    if ((is502or503 || isRateLimitMsg) && attempt < 3) {
      const retryAfterHeader = response.headers.get('retry-after');
      let delayMs = [2000, 4000, 8000][attempt];
      if (retryAfterHeader) {
        const parsedSec = parseInt(retryAfterHeader, 10);
        if (!isNaN(parsedSec) && parsedSec > 0) {
          delayMs = parsedSec * 1000;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        headers: response.headers,
        data: jsonData,
        blob: null,
        errorMessage: null,
      };
    }

    // Construct error message for not-ok response
    let errorMessage = `HTTP ${response.status}`;
    const remainingHeader = response.headers.get('x-ratelimit-remaining');
    const resetHeader = response.headers.get('x-ratelimit-reset');

    if (response.status === 401) {
      errorMessage = 'HTTP 401: Token rejected. Check the token in Settings.';
    } else if ((response.status === 403 || response.status === 429) && remainingHeader === '0') {
      let resetTime = '';
      if (resetHeader) {
        const sec = parseInt(resetHeader, 10);
        if (!isNaN(sec)) {
          resetTime = new Date(sec * 1000).toLocaleTimeString();
        }
      }
      errorMessage = `GitHub rate limit reached. Resets at ${resetTime}.`;
    } else if (jsonData && typeof jsonData === 'object' && 'message' in jsonData) {
      const msg = String((jsonData as { message?: unknown }).message || '');
      if (msg) {
        errorMessage = `HTTP ${response.status}: ${msg}`;
      }
    }

    return {
      ok: false,
      status: response.status,
      headers: response.headers,
      data: jsonData,
      blob: null,
      errorMessage,
    };
  }

  // Fallback if loop finishes unexpectedly
  return {
    ok: false,
    status: 0,
    headers: null,
    data: null,
    blob: null,
    errorMessage: 'Network error: unknown failure.',
  };
}

export function getUser(token: string): Promise<ApiResult> {
  return apiFetch('/user', { token });
}

export function getRateLimit(token: string | null): Promise<ApiResult> {
  return apiFetch('/rate_limit', { token: token || undefined, noAuth: !token });
}

export function getRepo(token: string | null, owner: string, repo: string): Promise<ApiResult> {
  return apiFetch(`/repos/${owner}/${repo}`, { token: token || undefined, noAuth: !token });
}
