'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BrowserMultiFormatReader } from '@zxing/library';

/**
 * Realtime licence-disc barcode scanner.
 *
 * The disc barcode is the ONLY data source in this application — there is no OCR
 * and no AI — so this replaces the previous "pick a photo and hope it decodes"
 * flow. The camera decodes continuously in the browser and the first successful
 * read is posted to the server, which parses and stores it.
 *
 * The reader is created lazily and torn down on unmount: `BrowserMultiFormatReader`
 * starts a decode loop bound to the video element, and a leaked reader keeps the
 * camera light on after the component is gone.
 */
export default function BarcodeScanner({ applicationId, onDone }: { applicationId: string; onDone?: () => void }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<BrowserMultiFormatReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Guards against a second POST: the decode loop fires continuously and would
  // otherwise submit the same code many times per second.
  const submittedRef = useRef(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');

  const stop = useCallback(() => {
    readerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video?.srcObject) {
      (video.srcObject as MediaStream).getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    }
    setActive(false);
  }, []);

  useEffect(() => stop, [stop]);

  async function start() {
    setError('');
    submittedRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser cannot access the camera.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      const reader = new BrowserMultiFormatReader();
      readerRef.current = reader;

      // PDF417 is the disc's symbology; hinting it makes the loop faster and
      // avoids latching onto an unrelated code in the background. `hints` is a
      // public property on the reader, set before the decode loop starts.
      (reader as unknown as { hints: unknown }).hints = new Map<number, unknown>([
        [1 /* DecodeHintType.TRY_HARDER */, true],
        [2 /* DecodeHintType.POSSIBLE_FORMATS */, [2 /* PDF_417 */, 0 /* QR_CODE */, 1 /* CODE_128 */, 4 /* DATA_MATRIX */]],
      ]);

      await reader.decodeFromVideoDevice(null, videoRef.current, (result, error) => {
        if (error || !result || submittedRef.current) return;
        const rawValue = result.getText()?.trim();
        if (!rawValue) return;
        submittedRef.current = true;
        void submit(rawValue);
      });
      setActive(true);
    } catch (err) {
      stop();
      setError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Camera permission was denied.'
          : 'Could not start the camera.'
      );
    }
  }

  async function submit(rawValue: string) {
    try {
      const response = await fetch(`/api/applications/${applicationId}/barcode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawValue }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? 'Could not read the barcode.');
        // Let the user retry rather than silently doing nothing.
        submittedRef.current = false;
        return;
      }
      stop();
      onDone?.();
      router.refresh();
    } catch {
      setError('Could not reach the server.');
      submittedRef.current = false;
    }
  }

  return (
    <div className="space-y-3">
      {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      {active ? (
        <>
          <video ref={videoRef} muted playsInline className="w-full max-w-sm rounded-lg border border-slate-200 bg-black" />
          <p className="text-sm text-slate-600">Point the camera at the barcode on the licence disc.</p>
          <button type="button" className="btn-secondary" onClick={stop}>Stop scanning</button>
        </>
      ) : (
        <button type="button" className="btn-primary" onClick={start}>Scan disc barcode</button>
      )}
    </div>
  );
}
