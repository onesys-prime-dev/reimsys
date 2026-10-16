import { useEffect, useState } from 'react';
import { Icon } from '../ui';

/** A window with one photo or PDF at full size, opened from the eye button next to a file. */
export function FilePreview({ title, url, pdf, onClose }: { title: string; url: string; pdf: boolean; onClose: () => void }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={`Preview of ${title}`}>
        <h2 style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h2>
        <div className="pv">
          {pdf ? <iframe src={url} title={title} />
            : broken ? <p>This photo cannot be shown here (some phone photo formats only open on the phone). It will still be uploaded and can be opened by the checker.</p>
            : <img src={url} alt={title} onError={() => setBroken(true)} />}
        </div>
        <div className="btns"><button className="btn" onClick={onClose}><Icon name="x" size={16} />Close</button></div>
      </div>
    </div>
  );
}
