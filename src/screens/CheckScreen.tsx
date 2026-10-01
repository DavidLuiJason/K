import { useState } from 'react';
import JSZip from 'jszip';
import { safeGet, safeSet, safeRemove } from '../lib/storage.ts';
import { gitBlobSha } from '../lib/gitsha.ts';
import { parseRepoInput } from '../lib/repoInput.ts';
import { getUser, getRateLimit, getRepo, apiFetch, ApiResult } from '../lib/github.ts';
import { ResultCard, ResultCardRow } from '../components/ResultCard.tsx';

export interface CheckScreenProps {
  addLog: (text: string) => void;
}

interface CheckResultItem {
  num: number;
  name: string;
  status: 'VERIFIED' | 'FAILED' | 'NOT VERIFIED';
  detail: string;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    return false;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false;
    }
  }
  return true;
}

export function CheckScreen({ addLog }: CheckScreenProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [overallResult, setOverallResult] = useState<'VERIFIED SUCCESS' | 'FAILED' | 'NOT VERIFIED' | null>(null);
  const [checkRows, setCheckRows] = useState<ResultCardRow[]>([]);
  const [reportText, setReportText] = useState<string>('RESHELL CHECK REPORT\nTime: (not run yet)\nPress "Run checks" to generate report.\nEND OF REPORT');
  const [copied, setCopied] = useState(false);
  const [copyBlockedMessage, setCopyBlockedMessage] = useState<string | null>(null);

  const runAllChecks = async () => {
    setIsRunning(true);
    setCopyBlockedMessage(null);
    const results: CheckResultItem[] = [];

    // Check 1: Browser storage
    try {
      let setOk = false;
      let getVal: string | null = null;
      let removeOk = false;
      try {
        setOk = safeSet('reshell.selftest', 'ok');
        getVal = safeGet('reshell.selftest');
      } finally {
        removeOk = safeRemove('reshell.selftest');
      }

      if (setOk && getVal === 'ok' && removeOk) {
        results.push({
          num: 1,
          name: 'Browser storage',
          status: 'VERIFIED',
          detail: 'write, read and delete worked',
        });
      } else {
        results.push({
          num: 1,
          name: 'Browser storage',
          status: 'FAILED',
          detail: 'storage read-back or cleanup failed',
        });
      }
    } catch (err: unknown) {
      safeRemove('reshell.selftest');
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        num: 1,
        name: 'Browser storage',
        status: 'FAILED',
        detail: msg,
      });
    }

    // Check 2: Git hash helper
    try {
      const bytes = new TextEncoder().encode('hello\n');
      const hash = await gitBlobSha(bytes);
      if (hash === 'ce013625030ba8dba906f756967f9e9ca394464a') {
        results.push({
          num: 2,
          name: 'Git hash helper',
          status: 'VERIFIED',
          detail: "matches git's known hash",
        });
      } else {
        results.push({
          num: 2,
          name: 'Git hash helper',
          status: 'FAILED',
          detail: `got ${hash}`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        num: 2,
        name: 'Git hash helper',
        status: 'FAILED',
        detail: msg,
      });
    }

    // Check 3: ZIP library
    try {
      const zip = new JSZip();
      zip.file('a.txt', 'alpha');
      zip.file('dir/b.txt', 'beta');
      const uint8 = await zip.generateAsync({ type: 'uint8array' });
      const loaded = await JSZip.loadAsync(uint8);
      const nonDirNames: string[] = [];
      for (const [path, entry] of Object.entries(loaded.files)) {
        if (!entry.dir) {
          nonDirNames.push(path);
        }
      }
      nonDirNames.sort();
      const textA = await loaded.file('a.txt')?.async('text');
      const textB = await loaded.file('dir/b.txt')?.async('text');

      if (
        nonDirNames.length === 2 &&
        nonDirNames[0] === 'a.txt' &&
        nonDirNames[1] === 'dir/b.txt' &&
        textA === 'alpha' &&
        textB === 'beta'
      ) {
        results.push({
          num: 3,
          name: 'ZIP library',
          status: 'VERIFIED',
          detail: `wrote and re-read a 2-file zip (${uint8.byteLength} bytes)`,
        });
      } else {
        results.push({
          num: 3,
          name: 'ZIP library',
          status: 'FAILED',
          detail: 're-read zip did not match',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        num: 3,
        name: 'ZIP library',
        status: 'FAILED',
        detail: msg,
      });
    }

    // Check 4: Repository link parser
    try {
      const testCases: Array<{ input: string; expected: Record<string, unknown> }> = [
        { input: 'octocat/Hello-World', expected: { ok: true, owner: 'octocat', repo: 'Hello-World' } },
        { input: 'https://github.com/octocat/Hello-World', expected: { ok: true, owner: 'octocat', repo: 'Hello-World' } },
        { input: 'https://www.github.com/octocat/Hello-World.git', expected: { ok: true, owner: 'octocat', repo: 'Hello-World' } },
        { input: 'https://github.com/octocat/Hello-World/tree/main', expected: { ok: true, owner: 'octocat', repo: 'Hello-World', ref: 'main' } },
        { input: 'https://github.com/octocat/Hello-World/tree/main/docs/guide/', expected: { ok: true, owner: 'octocat', repo: 'Hello-World', ref: 'main', subpath: 'docs/guide' } },
        { input: 'ftp://github.com/octocat/Hello-World', expected: { ok: false, error: 'Not a recognised GitHub repository link.' } },
        { input: 'octocat', expected: { ok: false, error: 'Not a recognised GitHub repository link.' } },
        { input: 'https://gitlab.com/a/b', expected: { ok: false, error: 'Not a recognised GitHub repository link.' } },
      ];

      let matchCount = 0;
      let firstMismatch = '';
      for (const tc of testCases) {
        const actual = parseRepoInput(tc.input);
        if (deepEqual(actual, tc.expected)) {
          matchCount++;
        } else if (!firstMismatch) {
          firstMismatch = tc.input;
        }
      }

      if (matchCount === 8) {
        results.push({
          num: 4,
          name: 'Repository link parser',
          status: 'VERIFIED',
          detail: '8 of 8 test links parsed as expected',
        });
      } else {
        results.push({
          num: 4,
          name: 'Repository link parser',
          status: 'FAILED',
          detail: `${matchCount} of 8 matched; first mismatch: ${firstMismatch}`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        num: 4,
        name: 'Repository link parser',
        status: 'FAILED',
        detail: msg,
      });
    }

    // Check 5: GitHub identity
    let savedToken = safeGet('reshell.token');
    if (savedToken) savedToken = savedToken.trim();
    let check5Response: ApiResult | null = null;
    let check5Verified = false;

    try {
      if (!savedToken) {
        results.push({
          num: 5,
          name: 'GitHub identity',
          status: 'NOT VERIFIED',
          detail: 'No token saved. Add it in Settings.',
        });
      } else {
        check5Response = await getUser(savedToken);
        addLog(`GET /user -> ${check5Response.status}`);

        if (check5Response.status === 200) {
          if (
            check5Response.data &&
            typeof check5Response.data === 'object' &&
            'login' in check5Response.data &&
            typeof (check5Response.data as { login?: unknown }).login === 'string' &&
            ((check5Response.data as { login: string }).login.trim().length > 0)
          ) {
            const login = (check5Response.data as { login: string }).login.trim();
            check5Verified = true;
            results.push({
              num: 5,
              name: 'GitHub identity',
              status: 'VERIFIED',
              detail: `Signed in as ${login}`,
            });
          } else {
            results.push({
              num: 5,
              name: 'GitHub identity',
              status: 'FAILED',
              detail: 'GitHub returned an unexpected identity response.',
            });
          }
        } else {
          results.push({
            num: 5,
            name: 'GitHub identity',
            status: 'FAILED',
            detail: check5Response.errorMessage || `HTTP ${check5Response.status}`,
          });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        num: 5,
        name: 'GitHub identity',
        status: 'FAILED',
        detail: msg,
      });
    }

    // Check 6: Token scopes
    try {
      if (!savedToken || !check5Verified || !check5Response) {
        results.push({
          num: 6,
          name: 'Token scopes',
          status: 'NOT VERIFIED',
          detail: 'Identity check did not pass.',
        });
      } else {
        const scopesHeader = check5Response.headers?.get('x-oauth-scopes');
        if (scopesHeader === null || scopesHeader === undefined) {
          results.push({
            num: 6,
            name: 'Token scopes',
            status: 'NOT VERIFIED',
            detail: 'GitHub did not expose token scopes to the browser. Scope verification could not be completed.',
          });
        } else {
          const rawParts = scopesHeader.split(',');
          const scopes = rawParts.map((p) => p.trim()).filter((p) => p.length > 0);
          const hasRepo = scopes.includes('repo');
          const hasWorkflow = scopes.includes('workflow');

          if (hasRepo && hasWorkflow) {
            results.push({
              num: 6,
              name: 'Token scopes',
              status: 'VERIFIED',
              detail: `scopes: ${scopes.join(', ')}`,
            });
          } else {
            const missing: string[] = [];
            if (!hasRepo) missing.push('repo');
            if (!hasWorkflow) missing.push('workflow');
            const scopeListStr = scopes.length > 0 ? scopes.join(', ') : 'none';
            results.push({
              num: 6,
              name: 'Token scopes',
              status: 'FAILED',
              detail: `Missing scope(s): ${missing.join(', ')}. Scopes: ${scopeListStr}`,
            });
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        num: 6,
        name: 'Token scopes',
        status: 'FAILED',
        detail: msg,
      });
    }

    // Check 7: Rate limit
    try {
      const rateRes = await getRateLimit(savedToken || null);
      addLog(`GET /rate_limit -> ${rateRes.status}`);

      if (rateRes.ok) {
        const dataObj = rateRes.data as { resources?: { core?: { limit?: unknown; remaining?: unknown; reset?: unknown } } } | null;
        const core = dataObj?.resources?.core;
        if (
          core &&
          typeof core.limit === 'number' &&
          typeof core.remaining === 'number' &&
          typeof core.reset === 'number'
        ) {
          const resetTime = new Date(core.reset * 1000).toLocaleTimeString();
          results.push({
            num: 7,
            name: 'Rate limit',
            status: 'VERIFIED',
            detail: `core: ${core.remaining} of ${core.limit} left, resets ${resetTime}`,
          });
        } else {
          results.push({
            num: 7,
            name: 'Rate limit',
            status: 'FAILED',
            detail: 'GitHub returned an unexpected rate-limit response.',
          });
        }
      } else {
        results.push({
          num: 7,
          name: 'Rate limit',
          status: 'FAILED',
          detail: rateRes.errorMessage || `HTTP ${rateRes.status}`,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        num: 7,
        name: 'Rate limit',
        status: 'FAILED',
        detail: msg,
      });
    }

    // Check 8: Build repository
    try {
      const rawSettings = safeGet('reshell.settings');
      let storedLogin: string | null = null;
      let buildRepoName = 'reshell-builds';
      if (rawSettings) {
        try {
          const parsed = JSON.parse(rawSettings);
          if (parsed && typeof parsed === 'object') {
            if (typeof parsed.login === 'string' && parsed.login.trim()) {
              storedLogin = parsed.login.trim();
            }
            const repoRegex = /^[A-Za-z0-9._-]{1,100}$/;
            if (
              typeof parsed.buildRepo === 'string' &&
              repoRegex.test(parsed.buildRepo.trim()) &&
              parsed.buildRepo.trim() !== '.' &&
              parsed.buildRepo.trim() !== '..'
            ) {
              buildRepoName = parsed.buildRepo.trim();
            }
          }
        } catch {}
      }

      if (!storedLogin) {
        results.push({
          num: 8,
          name: 'Build repository',
          status: 'NOT VERIFIED',
          detail: 'Signed-in login unknown.',
        });
      } else {
        const repoRes = await getRepo(savedToken || null, storedLogin, buildRepoName);
        addLog(`GET /repos/${storedLogin}/${buildRepoName} -> ${repoRes.status}`);

        if (repoRes.status === 200) {
          const rData = repoRes.data as { private?: unknown; default_branch?: unknown } | null;
          if (
            rData &&
            typeof rData === 'object' &&
            rData.private === true &&
            typeof rData.default_branch === 'string' &&
            rData.default_branch.trim().length > 0
          ) {
            results.push({
              num: 8,
              name: 'Build repository',
              status: 'VERIFIED',
              detail: `exists, private: yes, default branch: ${rData.default_branch.trim()}`,
            });
          } else if (rData && typeof rData === 'object' && rData.private === false) {
            results.push({
              num: 8,
              name: 'Build repository',
              status: 'FAILED',
              detail: 'The build repository is public. Reshell builds must go to a private repository.',
            });
          } else {
            results.push({
              num: 8,
              name: 'Build repository',
              status: 'FAILED',
              detail: 'GitHub returned an unexpected repository response.',
            });
          }
        } else if (repoRes.status === 404) {
          results.push({
            num: 8,
            name: 'Build repository',
            status: 'NOT VERIFIED',
            detail: 'does not exist yet. A later stage creates it automatically.',
          });
        } else {
          results.push({
            num: 8,
            name: 'Build repository',
            status: 'FAILED',
            detail: repoRes.errorMessage || `HTTP ${repoRes.status}`,
          });
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        num: 8,
        name: 'Build repository',
        status: 'FAILED',
        detail: msg,
      });
    }

    // Check 9: Public ZIP download
    try {
      const zipRes = await apiFetch('/repos/octocat/Hello-World/zipball', {
        noAuth: true,
        asBlob: true,
      });
      addLog(`GET /repos/octocat/Hello-World/zipball -> ${zipRes.status}`);

      if (zipRes.ok && zipRes.blob && zipRes.blob.size > 0) {
        const arrayBuf = await zipRes.blob.arrayBuffer();
        const loadedZip = await JSZip.loadAsync(arrayBuf);
        let nonDirCount = 0;
        for (const entry of Object.values(loadedZip.files)) {
          if (!entry.dir) {
            nonDirCount++;
          }
        }

        if (nonDirCount >= 1) {
          results.push({
            num: 9,
            name: 'Public ZIP download',
            status: 'VERIFIED',
            detail: `downloaded ${zipRes.blob.size} bytes containing ${nonDirCount} files`,
          });
        } else {
          results.push({
            num: 9,
            name: 'Public ZIP download',
            status: 'FAILED',
            detail: 'download opened but contained no files',
          });
        }
      } else {
        let errDetail = zipRes.errorMessage || `HTTP ${zipRes.status}`;
        if (zipRes.status === 0) {
          errDetail += ' The browser could not complete the request, so a later stage will use a fallback method for repository links.';
        }
        results.push({
          num: 9,
          name: 'Public ZIP download',
          status: 'FAILED',
          detail: errDetail,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        num: 9,
        name: 'Public ZIP download',
        status: 'FAILED',
        detail: msg,
      });
    }

    // Overall result calculation:
    // VERIFIED SUCCESS only when all nine checks are VERIFIED; FAILED when at least one check is FAILED; otherwise NOT VERIFIED.
    let overall: 'VERIFIED SUCCESS' | 'FAILED' | 'NOT VERIFIED';
    if (results.every((r) => r.status === 'VERIFIED')) {
      overall = 'VERIFIED SUCCESS';
    } else if (results.some((r) => r.status === 'FAILED')) {
      overall = 'FAILED';
    } else {
      overall = 'NOT VERIFIED';
    }
    setOverallResult(overall);

    // Rows for ResultCard
    const rows: ResultCardRow[] = results.map((r) => ({
      label: `${r.num}. ${r.name}`,
      value: r.detail,
      status: r.status,
    }));
    setCheckRows(rows);

    // Format plain text report
    const nowIso = new Date().toISOString();
    const reportLines = [
      'RESHELL CHECK REPORT',
      `Time: ${nowIso}`,
      `Overall: ${overall}`,
      ...results.map((r) => `${r.num}. ${r.name}: ${r.status} - ${r.detail}`),
      'END OF REPORT',
    ];
    setReportText(reportLines.join('\n'));
    setIsRunning(false);
  };

  const handleCopyReport = async () => {
    setCopyBlockedMessage(null);
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyBlockedMessage('Copy was blocked by the browser. Select the text below and copy it.');
    }
  };

  return (
    <div className="section-group">
      <div>
        <button
          type="button"
          className="btn btn-accent"
          style={{ width: '100%' }}
          onClick={runAllChecks}
          disabled={isRunning}
        >
          {isRunning ? (
            <span className="spinner-container">
              <span className="spinner" aria-hidden="true" />
              <span className="spinner-text">Working</span>
            </span>
          ) : (
            'Run checks'
          )}
        </button>
      </div>

      {overallResult !== null && (
        <ResultCard
          title="Check results"
          result={overallResult}
          rows={checkRows}
        />
      )}

      <div className="field-group">
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleCopyReport}
        >
          {copied ? 'Copied' : 'Copy report'}
        </button>
        {copyBlockedMessage && (
          <div className="notice-text" style={{ color: 'var(--warning-color)' }}>
            {copyBlockedMessage}
          </div>
        )}
        <textarea
          className="report-area"
          readOnly
          value={reportText}
          aria-label="Check report"
        />
      </div>
    </div>
  );
}
