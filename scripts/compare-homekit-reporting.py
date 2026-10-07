#!/usr/bin/env python3
"""Compare internal recording on/off without reconnecting HAP or moving hardware.

Only the authenticated, process-local diagnostic flag is changed. No polling
occurs while the owner performs a cycle; observations are taken at boundaries.
"""
import argparse
import http.client
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location("capture", Path(__file__).with_name("watch-homekit-events.py"))
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)
Error = capture.CaptureError


class Client:
    def __init__(self, storage):
        root = storage / "gdoorandbolt-coordinator"
        self.identity = json.loads((root / "identity.json").read_text())
        self.controllers = json.loads((root / "profiles.json").read_text())["configuration"]["controllers"]
        config = json.loads((storage / "config.json").read_text())
        platforms = [p for p in config.get("platforms", []) if p.get("platform") == "GDoorAndBoltCoordinator"]
        if len(platforms) != 1:
            raise Error("Expected one coordinator platform.")
        self.port = platforms[0].get("managementPort") or 27773

    def request(self, endpoint, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", int(self.port), timeout=3)
        try:
            headers = {"Authorization": "Bearer " + self.identity["token"]}
            data = None
            if body is not None:
                headers["Content-Type"] = "application/json"
                data = json.dumps({"instanceId": self.identity["instanceId"], **body})
            connection.request("GET" if body is None else "POST", endpoint, data, headers)
            response = connection.getresponse()
            if response.status != 200:
                raise Error("Local diagnostic request rejected (HTTP %d). Check that all controllers are idle and version 0.4.8+ is running." % response.status)
            raw = response.read(1048577)
            if len(raw) > 1048576:
                raise Error("Diagnostic response exceeded limit.")
            result = json.loads(raw)
            if result.get("instanceId") != self.identity["instanceId"]:
                raise Error("Coordinator identity changed.")
            return result
        finally:
            connection.close()

    def snapshot(self):
        result = self.request("/v1/homekit-reporting")["reporting"]
        if result.get("schema") != 1 or type(result.get("recording")) is not bool or not result.get("bootId"):
            raise Error("This comparison requires coordinator 0.4.8 or newer.")
        return result

    def recording(self, enabled):
        result = self.request("/v1/homekit-reporting/recording", {"recording": enabled})
        if result.get("recording") is not enabled:
            raise Error("Recording change was not confirmed.")

    def stationary(self, controller):
        status = self.request("/v1/controllers/" + controller + "/state")["status"]
        state = status["state"]
        if not status.get("actuationEnabled") or state.get("busy") or state.get("fault") or state.get("unavailable") or \
                any(state.get(k) != v for k, v in (("phase", "closed"), ("door", "closed"), ("bolt", "locked"))):
            raise Error("Controller must report enabled, idle, closed and locked before continuing.")


def subscribers(snapshot, controller):
    required = {"doorCurrent", "doorTarget"}
    return {c["id"] for c in snapshot.get("clients", []) if c.get("paired") and required <=
            {s["field"] for s in c.get("subscriptions", []) if s.get("controllerId") == controller}}


def compare_boundary(before, after, controller):
    return (before.get("bootId") == after.get("bootId") and
            before.get("recording") == after.get("recording") and
            before.get("recordingRevision") == after.get("recordingRevision") and
            bool(subscribers(before, controller)) and subscribers(before, controller) == subscribers(after, controller))


def show(label, snapshot, controller, since=0):
    print(label, json.dumps({"recording": snapshot["recording"], "recordingRevision": snapshot["recordingRevision"],
                            **capture.reporting_view(snapshot, {controller: "Garage 1"})}), flush=True)
    for event in snapshot.get("events", []):
        if event.get("sequence", 0) <= since or event.get("controllerId") != controller:
            continue
        row = {key: event.get(key) for key in ("sequence", "at", "monotonicMs", "kind", "field", "value", "explicit", "client", "subscribers") if key in event}
        print("TRACE", json.dumps(row), flush=True)


def run_trial(client, controller, enabled, baseline, label, ask=input):
    client.stationary(controller)
    client.recording(enabled)
    before = client.snapshot()
    if before["recording"] is not enabled:
        raise Error("Recording changed before this trial; comparison is inconclusive.")
    if before["bootId"] != baseline["bootId"] or subscribers(before, controller) != subscribers(baseline, controller):
        raise Error("Paired connection changed before this trial; comparison is inconclusive.")
    sequence = max([e.get("sequence", 0) for e in before.get("events", [])] or [0])
    print("\n%s — internal recording %s." % (label, "ON" if enabled else "OFF"), flush=True)
    print("Keep Home open. Use the indoor button to open fully, then close.\n"
          "After physical closure and bolt locking, watch the tile for 10 seconds.\n"
          "The script is now waiting; it sends no requests during your cycle.", flush=True)
    answer = ask("Enter c if Home showed Closed, s if still Closing, or q to stop: ").strip().lower()
    if answer not in ("c", "s"):
        raise Error("Comparison stopped by owner; no further cycle requested.")
    after = client.snapshot()
    show(label, after, controller, sequence)
    print("RESULT", json.dumps({"trial": label, "recording": enabled, "home": "closed" if answer == "c" else "closing",
                                 "sameConnectionAtBoundaries": compare_boundary(before, after, controller)}), flush=True)
    if not compare_boundary(before, after, controller):
        raise Error("Connection, recording mode or coordinator process changed; comparison is inconclusive.")
    client.stationary(controller)
    return answer


def compare(client, controller, ask=input):
    baseline = client.snapshot()
    if not subscribers(baseline, controller):
        raise Error("No paired client subscribes to both garage fields. Open Home before starting.")
    print("Runtime versions:", json.dumps({k: baseline.get(k) for k in ("homebridgeVersion", "hapVersion")}), flush=True)
    print("Keep Home visible throughout. Do not restart Homebridge or change configuration.\n"
          "This changes only internal diagnostic recording. It sends no door/bolt command.\n"
          "Recording will be restored ON when the comparison exits.", flush=True)
    try:
        first = run_trial(client, controller, True, baseline, "A", ask)
        if first != "c":
            print("RESULT: recording ON also failed. Stop here; this capture is the next evidence to inspect.", flush=True)
            return
        second = run_trial(client, controller, False, baseline, "B", ask)
        if second == "c":
            print("RESULT: both modes worked. Recording was not necessary for these cycles; stop testing here.", flush=True)
            return
        print("Recording OFF reproduced Closing. One ON comparison will test reversibility.", flush=True)
        third = run_trial(client, controller, True, baseline, "A2", ask)
        print("RESULT: " + ("ON worked, OFF failed, ON worked: strong evidence that instrumentation affects this failure."
                            if third == "c" else "The failure persisted after restoring ON; a simple recording dependency is not established."), flush=True)
    finally:
        try:
            client.recording(True)
            print("Internal recording restored ON. No state notifications were replayed.", flush=True)
        except Exception:
            print("Could not confirm recording restoration. When all controllers are idle, run:\n"
                  "sudo python3 -B scripts/compare-homekit-reporting.py --restore-recording\n"
                  "This affects diagnostics only; garage control is unchanged.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage", type=Path)
    parser.add_argument("--restore-recording", action="store_true")
    args = parser.parse_args()
    try:
        if args.storage:
            storage = args.storage.resolve()
        else:
            roots = {p.resolve() for p in (Path("/var/lib/homebridge"), Path("/home/homebridge/.homebridge"))
                     if (p / "gdoorandbolt-coordinator/profiles.json").is_file()}
            if len(roots) != 1:
                raise Error("Storage was not uniquely detected; supply --storage.")
            storage = roots.pop()
        client = Client(storage)
        info = client.request("/v1/identity")
        print("Running version:", info.get("pluginVersion", "unknown"), flush=True)
        if args.restore_recording:
            client.recording(True)
            print("Internal recording is ON.")
            return 0
        if not sys.stdin.isatty():
            raise Error("Run in an interactive terminal.")
        if len(client.controllers) == 1:
            controller = client.controllers[0]["id"]
        else:
            choice = int(input("Select garage number (1–%d, in configured order): " % len(client.controllers)))
            if not 1 <= choice <= len(client.controllers):
                raise Error("Invalid garage selection.")
            controller = client.controllers[choice - 1]["id"]
        compare(client, controller)
        return 0
    except (KeyboardInterrupt, EOFError):
        print("Comparison stopped.")
    except Error as error:
        print("Comparison stopped:", str(error))
    except Exception as error:
        print("Comparison stopped (%s); private details omitted." % type(error).__name__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
