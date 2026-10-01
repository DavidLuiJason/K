export interface ResultCardRow {
  label: string;
  value: string;
  status?: 'VERIFIED' | 'FAILED' | 'NOT VERIFIED';
}

export interface ResultCardProps {
  title: string;
  result: 'VERIFIED SUCCESS' | 'FAILED' | 'NOT VERIFIED' | null;
  rows: ResultCardRow[];
}

export function ResultCard({ title, result, rows }: ResultCardProps) {
  const getStatusClass = (status: string) => {
    if (status === 'VERIFIED' || status === 'VERIFIED SUCCESS') {
      return 'status-badge status-accent';
    }
    if (status === 'FAILED') {
      return 'status-badge status-error';
    }
    if (status === 'NOT VERIFIED') {
      return 'status-badge status-warning';
    }
    return 'status-badge';
  };

  return (
    <div className="result-card">
      <div className="result-card-header">
        <div className="result-card-title">{title}</div>
        {result !== null && (
          <span className={getStatusClass(result)}>{result}</span>
        )}
      </div>
      {rows.length > 0 && (
        <div className="result-rows">
          {rows.map((row, idx) => (
            <div key={idx} className="result-row">
              <div className="result-row-head">
                <span className="result-row-label">{row.label}</span>
                {row.status && (
                  <span className={getStatusClass(row.status)}>{row.status}</span>
                )}
              </div>
              {row.value ? (
                <div className="result-row-value">{row.value}</div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
