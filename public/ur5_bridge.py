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

async def telemetry_loop(rtde, ws, hz):
    interval = 1.0 / hz
    while True:
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
            }
            await ws.send(json.dumps(payload))
            await asyncio.sleep(interval)
        except websockets.ConnectionClosed:
            return

async def handle_command(ctrl, rtde, cmd, ws):
    """
    Supported commands:
      {"cmd":"stop"}
      {"cmd":"home", "speed":0.5}
      {"cmd":"jog_joint", "joint":0..5, "delta":<rad>, "speed":0.5}
      {"cmd":"jog_tcp",   "axis":"x|y|z|rx|ry|rz", "delta":<m or rad>, "speed":0.25}
      {"cmd":"set_do", "pin":0..7, "value":true|false}
    """
    op = cmd.get("cmd")
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
        elif op == "set_do":
            ctrl.setStandardDigitalOut(int(cmd["pin"]), bool(cmd["value"]))
        else:
            await ws.send(json.dumps({"type":"ack","ok":False,"error":f"unknown cmd {op}"}))
            return
        await ws.send(json.dumps({"type":"ack","ok":True,"cmd":op}))
    except Exception as e:
        await ws.send(json.dumps({"type":"ack","ok":False,"error":str(e)}))

async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--robot", required=True)
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--hz", type=float, default=20.0)
    p.add_argument("--readonly", action="store_true",
                   help="Disable Control interface (telemetry only)")
    args = p.parse_args()

    print(f"[bridge] RTDE receive -> {args.robot}")
    rtde = RTDEReceiveInterface(args.robot)
    ctrl = None
    if not args.readonly:
        print(f"[bridge] RTDE control -> {args.robot}")
        ctrl = RTDEControlInterface(args.robot)
    print(f"[bridge] ws://0.0.0.0:{args.port}")

    async def handler(ws):
        print(f"[bridge] client connected: {ws.remote_address}")
        producer = asyncio.create_task(telemetry_loop(rtde, ws, args.hz))
        try:
            async for raw in ws:
                try:
                    cmd = json.loads(raw)
                except Exception:
                    continue
                if ctrl is None:
                    await ws.send(json.dumps({"type":"ack","ok":False,"error":"readonly mode"}))
                    continue
                await handle_command(ctrl, rtde, cmd, ws)
        finally:
            producer.cancel()
            print("[bridge] client disconnected")

    async with websockets.serve(handler, "0.0.0.0", args.port):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())