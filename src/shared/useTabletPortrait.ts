import { useEffect, useState } from 'react';

const TABLET_PORTRAIT_MEDIA_QUERY =
  '(min-width: 600px) and (max-width: 1366px) and (orientation: portrait)';

function getIsTabletPortrait(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(TABLET_PORTRAIT_MEDIA_QUERY).matches;
}

export function useTabletPortrait(): boolean {
  const [isTabletPortrait, setIsTabletPortrait] = useState<boolean>(getIsTabletPortrait);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia(TABLET_PORTRAIT_MEDIA_QUERY);
    const update = () => setIsTabletPortrait(mq.matches);
    update();

    mq.addEventListener('change', update);
    window.addEventListener('orientationchange', update);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('orientationchange', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return isTabletPortrait;
}
