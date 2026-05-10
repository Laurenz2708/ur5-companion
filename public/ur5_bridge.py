#!/usr/bin/env python3
"""
UR5 RTDE <-> WebSocket bridge.

Run on a machine on the same network as the UR5 controller.
- Streams telemetry (Receive interface) to all connected browsers.
- Accepts simple control commands (Control interface) from the browser.

Install:
    pip install ur_rtde websockets

Run:
    python ur5_bridge.py --robot 192.168.1.10
"""
import argparse, asyncio, json, time
import websockets
from rtde_receive import RTDEReceiveInterface
from rtde_control  import RTDEControlInterface

SAFETY = {1:"NORMAL",2:"REDUCED",3:"PROTECTIVE_STOP",4:"RECOVERY",
          5:"SAFEGUARD_STOP",6:"SYSTEM_EMERGENCY_STOP",
          7:"ROBOT_EMERGENCY_STOP",8:"VIOLATION",9:"FAULT"}
MODES  = {-1:"NO_CONTROLLER",0:"DISCONNECTED",1:"CONFIRM_SAFETY",
          2:"BOOTING",3:"POWER_OFF",4:"POWER_ON",5:"IDLE",
          6:"BACKDRIVE",7:"RUNNING",8:"UPDATING_FIRMWARE"}

HOME_Q = [0.0, -1.5708, 0.0, -1.5708, 0.0, 0.0]  # safe default home

# TEMP DEBUG: bypass all bridge-side motion constraints so hand/speed commands
# reach the UR controller directly. The UR controller's own safety system still
# decides whether motion is accepted.
BYPASS_MOTION_CONSTRAINTS = True

# --- Workspace safety envelope (base frame, meters) -------------------------
# Tisch 1000 x 1000 mm, Roboter sitzt mittig am Aussenrand. +X zeigt ueber
# den Tisch, Y ist quer. Das Viereck unten ist die Tischflaeche / erlaubte
# Arbeitsbox. Keine zusaetzliche Kugel vom Sockel: die war zu streng, weil
# der TCP mit Tool-Laenge/Z-Hoehe sonst faelschlich als "out of reach" galt.
REACH_MAX = 1.30   # nur Plausibilitaets-Notbremse, nicht UR5-Nennreichweite
REACH_MIN = 0.05   # Saeule / Eigenkollision
X_MIN, X_MAX = -0.10, 1.00   # 10 cm hinter Sockel bis Tischende
Y_MIN, Y_MAX = -0.50, 0.50   # halbe Tischbreite links/rechts
Z_MIN     = -0.30  # bis zur Tischplatte
Z_MAX     =  1.00  # voller Hub nach oben
# Joint soft limits (rad). Stay clear of the natural mechanical extremes.
Q_LIMITS = [
    (-6.28,  6.28),  # base
    (-6.28,  6.28),  # shoulder
    (-3.14,  3.14),  # elbow
    (-6.28,  6.28),  # wrist 1
    (-6.28,  6.28),  # wrist 2
    (-6.28,  6.28),  # wrist 3
]

def _validate_pose(pose, ctrl=None, qnear=None):
    """Return (ok, reason) for a target TCP pose in the base frame."""
    if BYPASS_MOTION_CONSTRAINTS:
        return True, "constraints bypassed"
    try:
        x, y, z = pose[0], pose[1], pose[2]
    except Exception:
        return False, "invalid pose"
    r_xy = (x*x + y*y) ** 0.5
    r    = (x*x + y*y + z*z) ** 0.5
    if x < X_MIN or x > X_MAX: return False, f"x={x:.3f} ausserhalb Tisch [{X_MIN},{X_MAX}]"
    if y < Y_MIN or y > Y_MAX: return False, f"y={y:.3f} ausserhalb Tisch [{Y_MIN},{Y_MAX}]"
    if z < Z_MIN: return False, f"z={z:.3f} below floor ({Z_MIN})"
    if z > Z_MAX: return False, f"z={z:.3f} above ceiling ({Z_MAX})"
    if r > REACH_MAX: return False, f"workspace too far ({r:.3f} m > {REACH_MAX})"
    # Self-collision guard: tool must not enter the cylinder around the
    # column. Only enforced ABOVE the flange where the column actually is.
    if r_xy < REACH_MIN and z > 0.10:
        return False, "too close to base column (self-collision risk)"
    # Deliberately avoid active controller IK/safety calls here. On some UR/RTDE
    # versions those calls interfere with the active control script after a
    # rejected command, which made all later hand commands look ignored.
    return True, ""

def _validate_joints(q, ctrl=None):
    if BYPASS_MOTION_CONSTRAINTS:
        return True, "constraints bypassed"
    if len(q) < 6:
        return False, "invalid joint vector"
    for i, (lo, hi) in enumerate(Q_LIMITS):
        if not (lo <= q[i] <= hi):
            return False, f"J{i+1}={q[i]:.3f} outside [{lo:.2f},{hi:.2f}]"
    return True, ""

def _guard_current_state(rtde):
    """Block commands unless the robot is actually ready to accept motion."""
    if BYPASS_MOTION_CONSTRAINTS:
        return True, "constraints bypassed"
    try:
        mode = rtde.getRobotMode()
        safety = rtde.getSafetyMode()
    except Exception:
        return False, "robot state unavailable"
    if mode != 7:
        return False, f"robot not running ({MODES.get(mode, mode)})"
    if safety not in (1, 2):
        return False, f"safety stop active ({SAFETY.get(safety, safety)})"
    return True, ""

class RtdeBridge:
    def __init__(self, robot, readonly=False):
        self.robot = robot
        self.readonly = readonly
        self.rtde = None
        self.ctrl = None
        self.state = "disconnected"
        self.last_error = "waiting for first connection attempt"
        self.retry_after = 0.0
        self.ctrl_retry_after = 0.0
        self._lock = asyncio.Lock()

    async def ensure_connected(self):
        if self.rtde is not None:
            # Receive is up — try to (re)build control on demand.
            if (
                self.ctrl is None
                and not self.readonly
                and time.time() >= self.ctrl_retry_after
            ):
                try:
                    print(f"[bridge] RTDE control (retry) -> {self.robot}")
                    self.ctrl = RTDEControlInterface(self.robot)
                    self.last_error = None
                except Exception as ce:
                    self.ctrl = None
                    self.ctrl_retry_after = time.time() + 1.5
                    self.last_error = f"control unavailable: {ce}"
                    print(f"[bridge] control retry failed: {ce}")
            return True
        now = time.time()
        if now < self.retry_after:
            return False
        async with self._lock:
            if self.rtde is not None:
                return True
            self.state = "connecting"
            self.last_error = None
            try:
                print(f"[bridge] RTDE receive -> {self.robot}")
                rtde = RTDEReceiveInterface(self.robot)
                ctrl = None
                if not self.readonly:
                    try:
                        print(f"[bridge] RTDE control -> {self.robot}")
                        ctrl = RTDEControlInterface(self.robot)
                    except Exception as ce:
                        # Control interface is often unavailable during a
                        # protective/safeguard stop. Keep receive alive so
                        # telemetry (and the UI animation) keep flowing.
                        ctrl = None
                        print(f"[bridge] control init failed (continuing read-only): {ce}")
                        self.last_error = f"control unavailable: {ce}"
                self.rtde = rtde
                self.ctrl = ctrl
                if ctrl is None and not self.readonly:
                    self.ctrl_retry_after = time.time() + 1.5
                self.state = "connected"
                print(f"[bridge] robot connected: {self.robot}")
                return True
            except Exception as e:
                self.rtde = None
                self.ctrl = None
                self.state = "disconnected"
                self.last_error = str(e)
                self.retry_after = time.time() + 2.0
                print(f"[bridge] robot connection failed: {e}")
                return False

    def reset(self, reason):
        self.rtde = None
        self.ctrl = None
        self.state = "disconnected"
        self.last_error = reason
        self.retry_after = time.time() + 1.0
        self.ctrl_retry_after = 0.0

    def status_payload(self):
        return {
            "type": "status",
            "robot_connected": self.rtde is not None,
            "robot_host": self.robot,
            "robot_state": self.state,
            "robot_error": self.last_error,
            "readonly": self.readonly,
            "control_enabled": self.ctrl is not None,
            "t": time.time(),
        }

async def telemetry_loop(bridge, ws, hz):
    interval = 1.0 / hz
    while True:
        try:
            if not await bridge.ensure_connected():
                await ws.send(json.dumps(bridge.status_payload()))
                await asyncio.sleep(interval)
                continue

            rtde = bridge.rtde
            try:
                payload = {
                    "type": "telemetry",
                    "t": time.time(),
                    "tcp_pose":     rtde.getActualTCPPose(),
                    "tcp_speed":    rtde.getActualTCPSpeed(),
                    "joint_q":      rtde.getActualQ(),
                    "joint_qd":     rtde.getActualQd(),
                    "joint_temp":   rtde.getJointTemperatures(),
                    "joint_current":rtde.getActualCurrent(),
                    "tcp_force":    rtde.getActualTCPForce(),
                    "robot_mode":   MODES.get(rtde.getRobotMode(),"UNKNOWN"),
                    "safety_mode":  SAFETY.get(rtde.getSafetyMode(),"UNKNOWN"),
                    "digital_in":   rtde.getActualDigitalInputBits(),
                    "digital_out":  rtde.getActualDigitalOutputBits(),
                    "runtime_state":rtde.getRuntimeState(),
                    "robot_connected": True,
                    "robot_host": bridge.robot,
                    "control_enabled": bridge.ctrl is not None,
                }
                await ws.send(json.dumps(payload))
            except Exception as e:
                bridge.reset(str(e))
                await ws.send(json.dumps(bridge.status_payload()))
            await asyncio.sleep(interval)
        except websockets.ConnectionClosed:
            return

async def handle_command(bridge, cmd, ws):
    """
    Supported commands:
      {"cmd":"stop"}
      {"cmd":"home", "speed":0.5}
      {"cmd":"jog_joint", "joint":0..5, "delta":<rad>, "speed":0.5}
      {"cmd":"jog_tcp",   "axis":"x|y|z|rx|ry|rz", "delta":<m or rad>, "speed":0.25}
      {"cmd":"speed_tcp", "xd":[vx,vy,vz,wx,wy,wz], "accel":0.5}
      {"cmd":"set_do", "pin":0..7, "value":true|false}
      {"cmd":"git_pull"}
    """
    op = cmd.get("cmd")
    if op == "git_pull":
        import subprocess, os
        repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        try:
            out = subprocess.run(
                ["git", "-C", repo, "pull", "--ff-only"],
                capture_output=True, text=True, timeout=30,
            )
            msg = (out.stdout + out.stderr).strip()
            print(f"[bridge] git pull: {msg}")
            await ws.send(json.dumps({
                "type": "ack", "ok": out.returncode == 0, "cmd": op,
                "error": None if out.returncode == 0 else msg,
                "output": msg,
            }))
        except Exception as e:
            await ws.send(json.dumps({"type":"ack","ok":False,"cmd":op,"error":str(e)}))
        return
    if not await bridge.ensure_connected():
        await ws.send(json.dumps({
            "type": "ack",
            "ok": False,
            "cmd": op,
            "error": f"robot not connected: {bridge.last_error}",
        }))
        return
    if bridge.ctrl is None:
        await ws.send(json.dumps({"type":"ack","ok":False,"cmd":op,"error":"readonly mode"}))
        return

    ctrl = bridge.ctrl
    rtde = bridge.rtde
    try:
        ok, reason = _guard_current_state(rtde)
        if not ok and op != "stop":
            print(f"[bridge] blocked {op}: {reason}")
            await ws.send(json.dumps({"type":"ack","ok":False,"cmd":op,"error":f"blocked: {reason}"}))
            return
        if op == "stop":
            ctrl.stopJ(2.0)
        elif op == "home":
            ctrl.moveJ(HOME_Q, float(cmd.get("speed", 0.5)), 0.5)
        elif op == "jog_joint":
            j = int(cmd["joint"]); d = float(cmd["delta"])
            q = list(rtde.getActualQ()); q[j] += d
            ok, reason = _validate_joints(q, ctrl)
            if not ok:
                print(f"[bridge] blocked {op}: {reason}")
                await ws.send(json.dumps({"type":"ack","ok":False,"cmd":op,"error":f"blocked: {reason}"}))
                return
            ctrl.moveJ(q, float(cmd.get("speed", 0.5)), 0.5)
        elif op == "jog_tcp":
            axis = cmd["axis"]; d = float(cmd["delta"])
            idx = {"x":0,"y":1,"z":2,"rx":3,"ry":4,"rz":5}[axis]
            pose = list(rtde.getActualTCPPose()); pose[idx] += d
            ok, reason = _validate_pose(pose, ctrl, list(rtde.getActualQ()))
            if not ok:
                print(f"[bridge] blocked {op}: {reason}; target={pose[:3]}")
                await ws.send(json.dumps({"type":"ack","ok":False,"cmd":op,"error":f"blocked: {reason}"}))
                return
            ctrl.moveL(pose, float(cmd.get("speed", 0.25)), 0.5)
        elif op == "speed_tcp":
            xd = list(cmd.get("xd", [0,0,0,0,0,0]))
            while len(xd) < 6: xd.append(0.0)
            xd = [float(v) for v in xd[:6]]
            accel = float(cmd.get("accel", 0.5))
            if all(abs(v) < 1e-6 for v in xd):
                ctrl.speedStop(accel)
            elif BYPASS_MOTION_CONSTRAINTS:
                ctrl.speedL(xd, accel, 0.5)
            else:
                # Look ahead ~0.4 s along the requested velocity and refuse
                # if the predicted pose is unreachable / unsafe.
                pose_now = list(rtde.getActualTCPPose())
                target = [pose_now[i] + xd[i] * 0.4 for i in range(6)]
                ok, reason = _validate_pose(target, ctrl, list(rtde.getActualQ()))
                if not ok:
                    try: ctrl.speedStop(accel)
                    except Exception: pass
                    print(f"[bridge] blocked {op}: {reason}; target={target[:3]}; xd={xd[:3]}")
                    await ws.send(json.dumps({"type":"ack","ok":False,"cmd":op,"error":f"blocked: {reason}"}))
                    return
                # 0.5s watchdog — if no new speed_tcp arrives the robot stops.
                ctrl.speedL(xd, accel, 0.5)
        elif op == "set_do":
            ctrl.setStandardDigitalOut(int(cmd["pin"]), bool(cmd["value"]))
        else:
            await ws.send(json.dumps({"type":"ack","ok":False,"cmd":op,"error":f"unknown cmd {op}"}))
            return
        await ws.send(json.dumps({"type":"ack","ok":True,"cmd":op}))
    except Exception as e:
        print(f"[bridge] command failed {op}: {e}; payload={cmd}")
        try:
            ctrl.speedStop(0.5)
        except Exception:
            pass
        bridge.last_error = str(e)
        await ws.send(json.dumps({"type":"ack","ok":False,"cmd":op,"error":str(e)}))
        # Auto-recover: if the controller reported an unreachable / IK / safety
        # target, drive the robot back to HOME so the operator can continue.
        msg = str(e).lower()
        unreachable_hints = ("unreachable", "not reachable", "inverse kinem",
                             "ik", "singular", "out of reach", "joint limit",
                             "safety", "invalid target", "pose")
        if op in ("jog_tcp", "jog_joint", "speed_tcp", "moveL", "moveJ") \
                and any(h in msg for h in unreachable_hints):
            try:
                print(f"[bridge] auto-home after unreachable target ({op})")
                ctrl.moveJ(HOME_Q, 0.5, 0.5)
                await ws.send(json.dumps({"type":"ack","ok":True,"cmd":"home",
                                          "info":"auto-home after unreachable target"}))
            except Exception as he:
                print(f"[bridge] auto-home failed: {he}")

async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--robot", required=True)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--hz", type=float, default=20.0)
    p.add_argument("--readonly", action="store_true",
                   help="Disable Control interface (telemetry only)")
    args = p.parse_args()

    bridge = RtdeBridge(args.robot, readonly=args.readonly)
    print(f"[bridge] ws://0.0.0.0:{args.port}")

    async def handler(ws):
        print(f"[bridge] client connected: {ws.remote_address}")
        await ws.send(json.dumps(bridge.status_payload()))
        producer = asyncio.create_task(telemetry_loop(bridge, ws, args.hz))
        try:
            async for raw in ws:
                try:
                    cmd = json.loads(raw)
                except Exception:
                    continue
                await handle_command(bridge, cmd, ws)
        finally:
            producer.cancel()
            print("[bridge] client disconnected")

    async with websockets.serve(handler, "0.0.0.0", args.port):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())