import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Single-track audio player shared by every voice preview in the app.
 *
 * Only one track may sound at a time, so callers identify their tracks with a
 * stable key and compare it against {@link playingKey} and {@link loadingKey}
 * to render their own controls. Playing the key that is already running (or
 * still loading) stops it, which makes one button work as play and stop.
 */
export const useAudioTrack = () => {
  /** Tears down the element of the previous play, listeners included. */
  const releaseRef = useRef<(() => void) | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    releaseRef.current?.();
    releaseRef.current = null;
    setPlayingKey(null);
    setLoadingKey(null);
  }, []);

  useEffect(() => () => stop(), [stop]);

  const play = useCallback(
    (key: string, url: string, errorText: string) => {
      const isCurrent = playingKey === key || loadingKey === key;
      stop();
      if (isCurrent) return;

      setError(null);
      setLoadingKey(key);

      const audio = new Audio();

      const onCanPlay = () => {
        setLoadingKey(null);
        setPlayingKey(key);
        void audio.play().catch((err: unknown) => {
          setError(err instanceof Error ? err.message : errorText);
          setPlayingKey(null);
        });
      };
      const onEnded = () => setPlayingKey(null);
      const onError = () => {
        setLoadingKey(null);
        setPlayingKey(null);
        setError(errorText);
      };

      audio.addEventListener('canplay', onCanPlay);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('error', onError);

      releaseRef.current = () => {
        audio.removeEventListener('canplay', onCanPlay);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      };

      audio.src = url;
      audio.load();
    },
    [loadingKey, playingKey, stop],
  );

  return { playingKey, loadingKey, error, setError, play, stop };
};
