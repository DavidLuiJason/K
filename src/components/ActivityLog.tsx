import { useState } from 'react';

export interface ActivityLogProps {
  lines: string[];
}

export function ActivityLog({ lines }: ActivityLogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignored if browser blocks clipboard
    }
  };

  return (
    <div className="activity-log-panel">
      <div
        className="activity-log-header"
        onClick={() => setIsOpen(!isOpen)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            setIsOpen(!isOpen);
          }
        }}
      >
        <span className="activity-log-title">
          Activity log ({lines.length})
        </span>
        <div className="activity-log-actions">
          {lines.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ minHeight: '36px', height: '36px', fontSize: '13px', padding: '0 12px' }}
              onClick={handleCopy}
            >
              {copied ? 'Copied' : 'Copy log'}
            </button>
          )}
          <span style={{ fontSize: '14px', color: 'var(--muted-text)' }}>
            {isOpen ? '▲' : '▼'}
          </span>
        </div>
      </div>
      {isOpen && (
        <div className="activity-log-content">
          {lines.length === 0 ? (
            <div className="activity-log-empty">No activity recorded yet.</div>
          ) : (
            <div className="activity-log-entries">
              {lines.map((line, idx) => (
                <div key={idx} className="activity-log-entry">
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
