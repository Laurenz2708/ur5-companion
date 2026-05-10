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
    """
    op = cmd.get("cmd")
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
        if op == "stop":
            ctrl.stopJ(2.0)
        elif op == "home":
            ctrl.moveJ(HOME_Q, float(cmd.get("speed", 0.5)), 0.5)
        elif op == "jog_joint":
            j = int(cmd["joint"]); d = float(cmd["delta"])
            q = list(rtde.getActualQ()); q[j] += d
            ctrl.moveJ(q, float(cmd.get("speed", 0.5)), 0.5)
        elif op == "jog_tcp":
            axis = cmd["axis"]; d = float(cmd["delta"])
            idx = {"x":0,"y":1,"z":2,"rx":3,"ry":4,"rz":5}[axis]
            pose = list(rtde.getActualTCPPose()); pose[idx] += d
            ctrl.moveL(pose, float(cmd.get("speed", 0.25)), 0.5)
        elif op == "speed_tcp":
            xd = list(cmd.get("xd", [0,0,0,0,0,0]))
            while len(xd) < 6: xd.append(0.0)
            xd = [float(v) for v in xd[:6]]
            accel = float(cmd.get("accel", 0.5))
            if all(abs(v) < 1e-6 for v in xd):
                ctrl.speedStop(accel)
            else:
                # 0.5s watchdog — if no new speed_tcp arrives the robot stops.
                ctrl.speedL(xd, accel, 0.5)
        elif op == "set_do":
            ctrl.setStandardDigitalOut(int(cmd["pin"]), bool(cmd["value"]))
        else:
            await ws.send(json.dumps({"type":"ack","ok":False,"cmd":op,"error":f"unknown cmd {op}"}))
            return
        await ws.send(json.dumps({"type":"ack","ok":True,"cmd":op}))
    except Exception as e:
        # A failed command should NOT tear down the receive stream — that
        # froze the live preview after a safety stop. Drop control and let
        # ensure_connected() rebuild it on the next command attempt.
        bridge.ctrl = None
        bridge.ctrl_retry_after = time.time() + 0.5
        bridge.last_error = str(e)
        await ws.send(json.dumps({"type":"ack","ok":False,"cmd":op,"error":str(e)}))

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