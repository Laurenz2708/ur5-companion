import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/setup")({
  component: Setup,
  head: () => ({
    meta: [
      { title: "UR5 Bridge Setup — RTDE Console" },
      { name: "description", content: "Set up the local Python bridge that connects the UR5 controller via RTDE to the web console." },
    ],
  }),
});

function Code({ children }: { children: string }) {
  return (
    <pre className="panel p-4 font-mono text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed">
      {children}
    </pre>
  );
}

function Setup() {
  return (
    <main className="min-h-screen p-4 md:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-xl font-semibold">Bridge Setup</h1>
        <Link to="/" className="font-mono text-xs text-accent hover:underline">
          ← back to console
        </Link>
      </div>

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Why a bridge?
        </h2>
        <p className="text-sm text-foreground/90 leading-relaxed">
          RTDE is a raw TCP protocol on port <span className="font-mono text-primary">30004</span>.
          Browsers can&apos;t open raw TCP sockets, so a small Python script running on a machine
          on the same network as the UR5 talks to the robot and forwards telemetry over a
          WebSocket the browser can connect to.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          1 · Install dependencies
        </h2>
        <Code>{`pip install ur_rtde websockets`}</Code>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          2 · Download the bridge
        </h2>
        <p className="text-sm">
          <a
            href="/ur5_bridge.py"
            download
            className="font-mono text-accent underline underline-offset-4"
          >
            ur5_bridge.py
          </a>{" "}
          — a single-file script (~60 lines).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          3 · Run it
        </h2>
        <Code>{`python ur5_bridge.py --robot 192.168.1.10`}</Code>
        <p className="text-xs text-muted-foreground">
          Replace the IP with your UR5 controller&apos;s address. Default WebSocket port is{" "}
          <span className="font-mono text-foreground">8765</span>; override with{" "}
          <span className="font-mono text-foreground">--port</span>.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          4 · Connect from the console
        </h2>
        <p className="text-sm">
          Open the console and connect to{" "}
          <span className="font-mono text-primary">ws://&lt;bridge-host&gt;:8765</span>.
          If the bridge runs on the same machine as the browser, the default{" "}
          <span className="font-mono">ws://localhost:8765</span> works as-is.
        </p>
      </section>

      <section className="panel p-4 border-warning/40">
        <h3 className="font-mono text-xs text-warning mb-2">Mixed-content note</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Browsers block insecure <span className="font-mono">ws://</span> from pages served
          over <span className="font-mono">https://</span>. For production, terminate TLS in
          front of the bridge (e.g. with Caddy) and use{" "}
          <span className="font-mono">wss://</span>, or open the console from{" "}
          <span className="font-mono">http://localhost</span> while developing.
        </p>
      </section>
    </main>
  );
}