#!/usr/bin/env python3
"""
UR5 RTDE -> WebSocket bridge.

Run this on a machine on the same network as the UR5 controller.
It connects to the robot via RTDE and broadcasts live telemetry to any
browser connected to ws://<this-machine>:8765.

Install:
    pip install ur_rtde websockets

Run:
    python ur5_bridge.py --robot 192.168.1.10
"""
import argparse, asyncio, json, time
import websockets
from rtde_receive import RTDEReceiveInterface

SAFETY_MODES = {
    1: "NORMAL", 2: "REDUCED", 3: "PROTECTIVE_STOP", 4: "RECOVERY",
    5: "SAFEGUARD_STOP", 6: "SYSTEM_EMERGENCY_STOP",
    7: "ROBOT_EMERGENCY_STOP", 8: "VIOLATION", 9: "FAULT",
}
ROBOT_MODES = {
    -1: "NO_CONTROLLER", 0: "DISCONNECTED", 1: "CONFIRM_SAFETY",
    2: "BOOTING", 3: "POWER_OFF", 4: "POWER_ON", 5: "IDLE",
    6: "BACKDRIVE", 7: "RUNNING", 8: "UPDATING_FIRMWARE",
}

async def producer(rtde, ws, hz):
    interval = 1.0 / hz
    while True:
        try:
            payload = {
                "t": time.time(),
                "tcp_pose": rtde.getActualTCPPose(),       # [x,y,z,rx,ry,rz]
                "tcp_speed": rtde.getActualTCPSpeed(),
                "joint_q": rtde.getActualQ(),              # 6 joint angles (rad)
                "joint_qd": rtde.getActualQd(),            # joint speeds
                "joint_temp": rtde.getJointTemperatures(),
                "joint_current": rtde.getActualCurrent(),
                "tcp_force": rtde.getActualTCPForce(),
                "robot_mode": ROBOT_MODES.get(rtde.getRobotMode(), "UNKNOWN"),
                "safety_mode": SAFETY_MODES.get(rtde.getSafetyMode(), "UNKNOWN"),
                "digital_in": rtde.getActualDigitalInputBits(),
                "digital_out": rtde.getActualDigitalOutputBits(),
                "runtime_state": rtde.getRuntimeState(),
            }
            await ws.send(json.dumps(payload))
            await asyncio.sleep(interval)
        except websockets.ConnectionClosed:
            return

async def main():
    p = argparse.ArgumentParser()
    p.add_argument("--robot", required=True, help="UR5 controller IP")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--hz", type=float, default=20.0)
    args = p.parse_args()

    print(f"[bridge] connecting RTDE -> {args.robot}")
    rtde = RTDEReceiveInterface(args.robot)
    print(f"[bridge] listening ws://0.0.0.0:{args.port}")

    async def handler(ws):
        print(f"[bridge] client connected: {ws.remote_address}")
        try:
            await producer(rtde, ws, args.hz)
        finally:
            print("[bridge] client disconnected")

    async with websockets.serve(handler, "0.0.0.0", args.port):
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())