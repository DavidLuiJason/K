import { useState, useEffect } from 'react';
import { safeGet, safeSet, safeRemove } from '../lib/storage.ts';
import { getUser } from '../lib/github.ts';
import { ResultCard, ResultCardRow } from '../components/ResultCard.tsx';

export interface SettingsScreenProps {
  onSettingsChanged: () => void;
  addLog: (text: string) => void;
  settingsVersion: number;
}

export function SettingsScreen({ onSettingsChanged, addLog, settingsVersion }: SettingsScreenProps) {
  const [tokenInput, setTokenInput] = useState('');
  const [buildRepoInput, setBuildRepoInput] = useState('reshell-builds');

  const [hasToken, setHasToken] = useState(false);
  const [loginName, setLoginName] = useState<string | null>(null);

  // Operation state for Save token: 'READY' | 'RUNNING' | 'RESULT'
  const [tokenOpState, setTokenOpState] = useState<'READY' | 'RUNNING' | 'RESULT'>('READY');
  const [tokenCardResult, setTokenCardResult] = useState<'VERIFIED SUCCESS' | 'FAILED' | null>(null);
  const [tokenCardRows, setTokenCardRows] = useState<ResultCardRow[]>([]);

  // Operation state for Save name: 'READY' | 'RUNNING' | 'RESULT'
  const [nameCardResult, setNameCardResult] = useState<'VERIFIED SUCCESS' | 'FAILED' | null>(null);
  const [nameCardRows, setNameCardRows] = useState<ResultCardRow[]>([]);

  useEffect(() => {
    const token = safeGet('reshell.token');
    setHasToken(Boolean(token && token.trim()));

    const rawSettings = safeGet('reshell.settings');
    let login: string | null = null;
    let repo = 'reshell-builds';
    if (rawSettings) {
      try {
        const parsed = JSON.parse(rawSettings);
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.login === 'string' && parsed.login.trim()) {
            login = parsed.login.trim();
          }
          if (typeof parsed.buildRepo === 'string' && parsed.buildRepo.trim()) {
            repo = parsed.buildRepo.trim();
          }
        }
      } catch {}
    }
    setLoginName(login);
    setBuildRepoInput(repo);
  }, [settingsVersion]);

  const handleSaveToken = async () => {
    const candidate = tokenInput.trim();
    if (!candidate) {
      setTokenOpState('RESULT');
      setTokenCardResult('FAILED');
      setTokenCardRows([{ label: 'Reason: Paste a token first.', value: '' }]);
      return;
    }

    setTokenOpState('RUNNING');
    const userRes = await getUser(candidate);
    addLog(`GET /user -> ${userRes.status}`);

    if (userRes.ok && userRes.data && typeof userRes.data === 'object' && 'login' in userRes.data) {
      const dataObj = userRes.data as { login?: unknown };
      if (typeof dataObj.login === 'string' && dataObj.login.trim().length > 0) {
        const newLogin = dataObj.login.trim();
        const storedTokenOk = safeSet('reshell.token', candidate);

        // Update reshell.settings
        const rawSettings = safeGet('reshell.settings');
        let settingsObj: Record<string, unknown> = {};
        if (rawSettings) {
          try {
            settingsObj = JSON.parse(rawSettings) || {};
          } catch {}
        }
        settingsObj.login = newLogin;
        const storedSettingsOk = safeSet('reshell.settings', JSON.stringify(settingsObj));

        if (!storedTokenOk || !storedSettingsOk) {
          setTokenOpState('RESULT');
          setTokenCardResult('FAILED');
          setTokenCardRows([{ label: 'Reason: The browser refused to store the token.', value: '' }]);
          return;
        }

        setTokenInput('');
        setTokenOpState('RESULT');
        setTokenCardResult('VERIFIED SUCCESS');
        setTokenCardRows([{ label: `Signed in as ${newLogin}`, value: '' }]);
        onSettingsChanged();
        return;
      } else {
        setTokenOpState('RESULT');
        setTokenCardResult('FAILED');
        setTokenCardRows([{ label: 'Reason: GitHub returned an unexpected identity response.', value: '' }]);
        return;
      }
    } else {
      setTokenOpState('RESULT');
      setTokenCardResult('FAILED');
      const reason = userRes.errorMessage || `HTTP ${userRes.status}`;
      setTokenCardRows([{ label: `Reason: ${reason}`, value: '' }]);
      return;
    }
  };

  const handleForgetToken = () => {
    safeRemove('reshell.token');
    const rawSettings = safeGet('reshell.settings');
    let settingsObj: Record<string, unknown> = {};
    if (rawSettings) {
      try {
        settingsObj = JSON.parse(rawSettings) || {};
      } catch {}
    }
    delete settingsObj.login;
    safeSet('reshell.settings', JSON.stringify(settingsObj));
    setTokenOpState('READY');
    setTokenCardResult(null);
    setTokenCardRows([]);
    onSettingsChanged();
  };

  const handleSaveName = () => {
    const name = buildRepoInput.trim();
    const repoRegex = /^[A-Za-z0-9._-]{1,100}$/;
    if (!repoRegex.test(name) || name === '.' || name === '..') {
      setNameCardResult('FAILED');
      setNameCardRows([{ label: 'Reason: Invalid repository name.', value: '' }]);
      return;
    }

    const rawSettings = safeGet('reshell.settings');
    let settingsObj: Record<string, unknown> = {};
    if (rawSettings) {
      try {
        settingsObj = JSON.parse(rawSettings) || {};
      } catch {}
    }
    settingsObj.buildRepo = name;
    const writeOk = safeSet('reshell.settings', JSON.stringify(settingsObj));

    // Read back verification
    const readBackRaw = safeGet('reshell.settings');
    let readBackRepo: string | null = null;
    if (readBackRaw) {
      try {
        const parsed = JSON.parse(readBackRaw);
        if (parsed && typeof parsed.buildRepo === 'string') {
          readBackRepo = parsed.buildRepo;
        }
      } catch {}
    }

    if (writeOk && readBackRepo === name) {
      setNameCardResult('VERIFIED SUCCESS');
      setNameCardRows([{ label: `Build repository: ${name}`, value: '' }]);
      onSettingsChanged();
    } else {
      setNameCardResult('FAILED');
      setNameCardRows([{ label: 'Reason: The browser refused to store the name.', value: '' }]);
    }
  };

  return (
    <div className="section-group">
      {/* 1. Status line */}
      <div className="status-box">
        <div className="status-line">
          Token: {hasToken ? 'saved' : 'not saved'}
        </div>
        <div className="status-line-secondary">
          {loginName ? `Signed in as ${loginName}` : 'Not signed in'}
        </div>
      </div>

      {/* 2. Token input and Save token button */}
      <div className="field-group">
        <label className="field-label">GitHub personal access token</label>
        <div className="input-row">
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            className="text-input"
            placeholder="Paste classic token"
            disabled={tokenOpState === 'RUNNING'}
          />
          <button
            type="button"
            className="btn btn-accent"
            onClick={handleSaveToken}
            disabled={tokenOpState === 'RUNNING'}
          >
            {tokenOpState === 'RUNNING' ? (
              <span className="spinner-container">
                <span className="spinner" aria-hidden="true" />
                <span className="spinner-text">Working</span>
              </span>
            ) : (
              'Save token'
            )}
          </button>
        </div>
      </div>

      {/* Operation Result for Save token */}
      {tokenOpState === 'RUNNING' && (
        <ResultCard
          title="Save token"
          result={null}
          rows={[{ label: 'Checking token with GitHub...', value: '' }]}
        />
      )}
      {tokenOpState === 'RESULT' && tokenCardResult !== null && (
        <ResultCard
          title="Save token"
          result={tokenCardResult}
          rows={tokenCardRows}
        />
      )}

      {/* 3. Help text */}
      <div className="notice-text">
        Create a classic personal access token at github.com/settings/tokens with the scopes repo and workflow, and set an expiration date. Fine-grained tokens are not supported in this version.
      </div>

      {/* 4. Forget token button */}
      <div>
        <button
          type="button"
          className="btn btn-danger"
          style={{ width: '100%' }}
          onClick={handleForgetToken}
          disabled={!hasToken && !loginName}
        >
          Forget token
        </button>
      </div>

      {/* 5. Warning text */}
      <div className="warning-box">
        This version uses a classic GitHub personal access token. A classic token can have broad access to repositories available to your account. Use an expiration date and never use a token with more access than you are willing to give Reshell. The token is stored in this browser's local storage. Anyone who can use this browser profile may be able to use the stored token.
      </div>

      {/* 6. Build repository name */}
      <div className="field-group">
        <label className="field-label">Build repository name</label>
        <div className="input-row">
          <input
            type="text"
            value={buildRepoInput}
            onChange={(e) => setBuildRepoInput(e.target.value)}
            className="text-input"
            placeholder="reshell-builds"
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveName}
          >
            Save name
          </button>
        </div>
      </div>

      {/* Result for Save name */}
      {nameCardResult !== null && (
        <ResultCard
          title="Save name"
          result={nameCardResult}
          rows={nameCardRows}
        />
      )}
    </div>
  );
}
