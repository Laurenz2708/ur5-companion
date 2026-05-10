import { useEffect, useRef, useState, useCallback } from "react";

export type Telemetry = {
  type?: "telemetry";
  t: number;
  tcp_pose: number[];
  tcp_speed: number[];
  joint_q: number[];
  joint_qd: number[];
  joint_temp: number[];
  joint_current: number[];
  tcp_force: number[];
  robot_mode: string;
  safety_mode: string;
  digital_in: number;
  digital_out: number;
  runtime_state: number;
  robot_connected?: boolean;
  robot_host?: string;
};

export type BridgeStatus = {
  robotConnected: boolean;
  robotHost?: string;
  robotState: "connected" | "connecting" | "disconnected" | string;
  robotError?: string | null;
  readonly?: boolean;
  controlEnabled?: boolean;
  t?: number;
};

export type ConnState = "idle" | "connecting" | "open" | "closed" | "error";

export type Ack = {
  ok: boolean;
  cmd?: string;
  error?: string;
  t: number;
};

const DEFAULT_URL =
  typeof window !== "undefined"
    ? localStorage.getItem("ur5_ws_url") || "ws://localhost:8765"
    : "ws://localhost:8765";

export function useRtdeSocket() {
  const [url, setUrlState] = useState<string>(DEFAULT_URL);
  const [state, setState] = useState<ConnState>("idle");
  const [data, setData] = useState<Telemetry | null>(null);
  const [hz, setHz] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [lastAck, setLastAck] = useState<Ack | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const tickRef = useRef<{ count: number; last: number }>({ count: 0, last: performance.now() });

  const setUrl = useCallback((u: string) => {
    setUrlState(u);
    if (typeof window !== "undefined") localStorage.setItem("ur5_ws_url", u);
  }, []);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setState("closed");
  }, []);

  const connect = useCallback(() => {
    disconnect();
    setError(null);
    setState("connecting");
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onopen = () => setState("open");
      ws.onclose = () => setState("closed");
      ws.onerror = () => {
        setError("WebSocket error — is the bridge running?");
        setState("error");
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg && msg.type === "ack") {
            setLastAck({
              ok: !!msg.ok,
              cmd: msg.cmd,
              error: msg.error,
              t: Date.now(),
            });
            return;
          }
          if (msg && msg.type === "status") {
            setBridgeStatus({
              robotConnected: !!msg.robot_connected,
              robotHost: msg.robot_host,
              robotState: msg.robot_state || "disconnected",
              robotError: msg.robot_error,
              readonly: msg.readonly,
              controlEnabled: msg.control_enabled,
              t: msg.t,
            });
            return;
          }
          if (msg && msg.type === "telemetry") {
            setBridgeStatus({
              robotConnected: msg.robot_connected ?? true,
              robotHost: msg.robot_host,
              robotState: "connected",
              robotError: null,
              controlEnabled: true,
              t: msg.t,
            });
          }
          setData(msg as Telemetry);
          const now = performance.now();
          tickRef.current.count++;
          if (now - tickRef.current.last >= 1000) {
            setHz(tickRef.current.count);
            tickRef.current.count = 0;
            tickRef.current.last = now;
          }
        } catch {
          /* ignore */
        }
      };
    } catch (e) {
      setError(String(e));
      setState("error");
    }
  }, [url, disconnect]);

  const send = useCallback((cmd: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(cmd));
      return true;
    }
    return false;
  }, []);

  useEffect(() => () => wsRef.current?.close(), []);

  return { url, setUrl, state, data, hz, error, lastAck, bridgeStatus, connect, disconnect, send };
}