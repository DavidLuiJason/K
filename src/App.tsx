import { useState, useEffect, useCallback } from 'react';
import { safeRemove } from './lib/storage.ts';
import { SettingsScreen } from './screens/SettingsScreen.tsx';
import { CheckScreen } from './screens/CheckScreen.tsx';
import { ActivityLog } from './components/ActivityLog.tsx';

export default function App() {
  const [activeTab, setActiveTab] = useState<'settings' | 'check'>('settings');
  const [logs, setLogs] = useState<string[]>([]);
  const [settingsVersion, setSettingsVersion] = useState(0);

  useEffect(() => {
    // When the app starts, remove leftover test key from storage
    safeRemove('reshell.selftest');
  }, []);

  const addLog = useCallback((text: string) => {
    const time = new Date().toTimeString().slice(0, 8);
    const line = `${time} ${text}`;
    setLogs((prev) => [...prev.slice(-199), line]);
  }, []);

  const incrementSettingsVersion = useCallback(() => {
    setSettingsVersion((v) => v + 1);
  }, []);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1 className="app-title">Reshell</h1>
      </header>

      <main className="main-content">
        <div style={{ display: activeTab === 'settings' ? 'block' : 'none' }}>
          <SettingsScreen
            onSettingsChanged={incrementSettingsVersion}
            addLog={addLog}
            settingsVersion={settingsVersion}
          />
        </div>

        <div style={{ display: activeTab === 'check' ? 'block' : 'none' }}>
          <CheckScreen addLog={addLog} />
        </div>

        <ActivityLog lines={logs} />
      </main>

      <nav className="tab-bar">
        <div className="tab-bar-inner">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'check' ? 'active' : ''}`}
            onClick={() => setActiveTab('check')}
          >
            Check
          </button>
        </div>
      </nav>
    </div>
  );
}
