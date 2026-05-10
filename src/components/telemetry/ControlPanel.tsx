import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Home, Square, ArrowDown, ArrowUp } from "lucide-react";

type Sender = (cmd: object) => boolean;

const JOINTS = ["Base", "Shoulder", "Elbow", "Wrist 1", "Wrist 2", "Wrist 3"];
const TCP_AXES: Array<{ key: "x"|"y"|"z"|"rx"|"ry"|"rz"; label: string; unit: string }> = [
  { key: "x", label: "X", unit: "m" },
  { key: "y", label: "Y", unit: "m" },
  { key: "z", label: "Z", unit: "m" },
  { key: "rx", label: "Rx", unit: "rad" },
  { key: "ry", label: "Ry", unit: "rad" },
  { key: "rz", label: "Rz", unit: "rad" },
];

export function ControlPanel({
  send, enabled,
}: { send: Sender; enabled: boolean }) {
  const [step, setStep] = useState(5); // degrees / cm
  const [speed, setSpeed] = useState(0.3);

  const jogJoint = (i: number, dir: 1 | -1) =>
    send({ cmd: "jog_joint", joint: i, delta: dir * (step * Math.PI / 180), speed });
  const jogTcp = (axis: typeof TCP_AXES[number]["key"], dir: 1 | -1) => {
    const isRot = axis.startsWith("r");
    const delta = isRot ? dir * (step * Math.PI / 180) : dir * (step / 100);
    send({ cmd: "jog_tcp", axis, delta, speed });
  };

  const disabled = !enabled;

  return (
    <div className="panel p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Controls</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Move the robot in small increments
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="rounded-xl"
            disabled={disabled}
            onClick={() => send({ cmd: "home", speed })}
          >
            <Home className="h-3.5 w-3.5 mr-1.5" /> Home
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="rounded-xl"
            disabled={disabled}
            onClick={() => send({ cmd: "stop" })}
          >
            <Square className="h-3.5 w-3.5 mr-1.5" /> Stop
          </Button>
        </div>
      </div>

      {/* Sliders */}
      <div className="grid sm:grid-cols-2 gap-5">
        <SliderRow
          label="Step"
          value={step}
          min={1} max={45} step={1}
          onChange={setStep}
          display={`${step}° / ${step} cm`}
        />
        <SliderRow
          label="Speed"
          value={speed}
          min={0.05} max={1} step={0.05}
          onChange={setSpeed}
          display={`${speed.toFixed(2)} ×`}
        />
      </div>

      {/* TCP jog */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Tool position
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {TCP_AXES.map((a) => (
            <div
              key={a.key}
              className="rounded-xl bg-secondary/60 p-3 flex items-center justify-between"
            >
              <div>
                <div className="text-sm font-semibold">{a.label}</div>
                <div className="text-[10px] text-muted-foreground">{a.unit}</div>
              </div>
              <div className="flex gap-1">
                <JogBtn disabled={disabled} onClick={() => jogTcp(a.key, -1)}>−</JogBtn>
                <JogBtn disabled={disabled} onClick={() => jogTcp(a.key, 1)}>+</JogBtn>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Joint jog */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
          Joints
        </h3>
        <div className="space-y-1.5">
          {JOINTS.map((name, i) => (
            <div
              key={name}
              className="flex items-center justify-between rounded-xl bg-secondary/60 px-4 py-2.5"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-primary font-semibold w-7">
                  J{i + 1}
                </span>
                <span className="text-sm">{name}</span>
              </div>
              <div className="flex gap-1">
                <JogBtn disabled={disabled} onClick={() => jogJoint(i, -1)}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </JogBtn>
                <JogBtn disabled={disabled} onClick={() => jogJoint(i, 1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </JogBtn>
              </div>
            </div>
          ))}
        </div>
      </section>

      {!enabled && (
        <p className="text-xs text-muted-foreground text-center">
          Connect to the bridge to enable controls
        </p>
      )}
    </div>
  );
}

function JogBtn({
  children, onClick, disabled,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-8 w-8 rounded-lg bg-card border border-border flex items-center justify-center text-sm font-medium hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors disabled:opacity-40 disabled:hover:bg-card disabled:hover:text-foreground disabled:hover:border-border"
    >
      {children}
    </button>
  );
}

function SliderRow({
  label, value, min, max, step, onChange, display,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; display: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        <span className="text-sm font-mono tabular-nums">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min} max={max} step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}