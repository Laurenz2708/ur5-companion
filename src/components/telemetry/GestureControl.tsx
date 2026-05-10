import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  GestureRecognizer,
  FilesetResolver,
  type GestureRecognizerResult,
} from "@mediapipe/tasks-vision";

type Props = {
  send: (cmd: object) => boolean;
  enabled: boolean;
};

const STEP_M = 0.02; // 2 cm per command
const SEND_INTERVAL_MS = 250;
const SPEED = 0.25;
const HOME_COOLDOWN_MS = 3000;

export function GestureControl({ send, enabled }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recognizerRef = useRef<GestureRecognizer | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastSentRef = useRef(0);
  const lastHomeRef = useRef(0);

  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gesture, setGesture] = useState<string>("—");
  const [score, setScore] = useState(0);

  useEffect(() => {
    return () => {
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureRecognizer() {
    if (recognizerRef.current) return recognizerRef.current;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
    );
    const recognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
    });
    recognizerRef.current = recognizer;
    return recognizer;
  }

  async function start() {
    setError(null);
    setLoading(true);
    try {
      await ensureRecognizer();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 480, height: 360 },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      setActive(true);
      loop();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function stop() {
    setActive(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const v = videoRef.current;
    const stream = v?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
    setGesture("—");
    setScore(0);
  }

  function loop() {
    const video = videoRef.current;
    const recognizer = recognizerRef.current;
    if (!video || !recognizer) return;

    const tick = () => {
      if (!videoRef.current || !recognizerRef.current) return;
      if (video.readyState >= 2) {
        const now = performance.now();
        let result: GestureRecognizerResult | null = null;
        try {
          result = recognizer.recognizeForVideo(video, now);
        } catch {
          /* ignore frame errors */
        }
        drawOverlay(result);
        handleResult(result, now);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function drawOverlay(result: GestureRecognizerResult | null) {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!result?.landmarks?.length) return;
    ctx.fillStyle = "#22c55e";
    for (const hand of result.landmarks) {
      for (const lm of hand) {
        ctx.beginPath();
        ctx.arc((1 - lm.x) * w, lm.y * h, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function handleResult(
    result: GestureRecognizerResult | null,
    now: number,
  ) {
    const top = result?.gestures?.[0]?.[0];
    if (!top) {
      setGesture("—");
      setScore(0);
      return;
    }
    setGesture(top.categoryName);
    setScore(top.score);

    if (!enabled) return;
    if (top.score < 0.6) return;
    if (now - lastSentRef.current < SEND_INTERVAL_MS) return;

    let delta = 0;
    if (top.categoryName === "Open_Palm") {
      if (now - lastHomeRef.current < HOME_COOLDOWN_MS) return;
      const ok = send({ cmd: "home", speed: 0.5 });
      if (ok) {
        lastHomeRef.current = now;
        lastSentRef.current = now;
      }
      return;
    }
    if (top.categoryName === "Thumb_Up") delta = STEP_M;
    else if (top.categoryName === "Thumb_Down") delta = -STEP_M;
    else return;

    const ok = send({
      cmd: "jog_tcp",
      axis: "z",
      delta,
      speed: SPEED,
    });
    if (ok) lastSentRef.current = now;
  }

  return (
    <div className="panel p-6 space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold tracking-tight">Gesture control</h2>
        <span className="text-xs text-muted-foreground">
          👍 up · 👎 down · ✋ home
        </span>
      </div>

      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-secondary/60">
        <video
          ref={videoRef}
          className="absolute inset-0 h-full w-full object-cover -scale-x-100"
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full pointer-events-none"
        />
        {!active && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {loading ? "Loading model…" : "Camera off"}
          </div>
        )}
        {active && (
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between rounded-xl bg-background/80 px-3 py-1.5 backdrop-blur">
            <span className="text-xs font-mono">{gesture}</span>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {(score * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="text-xs text-destructive">{error}</div>
      )}

      <div className="flex gap-2">
        {!active ? (
          <Button onClick={start} disabled={loading} className="rounded-xl flex-1">
            {loading ? "Starting…" : "Start camera"}
          </Button>
        ) : (
          <Button onClick={stop} variant="secondary" className="rounded-xl flex-1">
            Stop camera
          </Button>
        )}
      </div>

      {!enabled && active && (
        <div className="text-[11px] text-warning">
          Connect to the bridge to send commands.
        </div>
      )}
    </div>
  );
}