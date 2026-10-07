#!/usr/bin/env python3
"""Run a reporting experiment without reconnecting HAP or commanding hardware.

Only authenticated, process-local reporting options are changed. No polling
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

    def experiment(self, trace_mode, publication_mode):
        result = self.request("/v1/homekit-reporting/experiment", {"traceMode": trace_mode, "publicationMode": publication_mode})
        if (result.get("traceMode"), result.get("publicationMode")) != (trace_mode, publication_mode):
            raise Error("Reporting experiment was not confirmed.")

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
            all(before.get(key) == after.get(key) for key in ("traceMode", "publicationMode", "publicationRevision")) and
            bool(subscribers(before, controller)) and subscribers(before, controller) == subscribers(after, controller))


def show(label, snapshot, controller, since=0):
    print(label, json.dumps({"recording": snapshot["recording"], "recordingRevision": snapshot["recordingRevision"],
                            **{key: snapshot[key] for key in ("traceMode", "publicationMode", "publicationRevision") if key in snapshot},
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
    if baseline.get("publicationMode", "inline") != "inline":
        raise Error("Restore the inline baseline before an ON/OFF comparison (--restore-baseline on 0.4.9+).")
    if not subscribers(baseline, controller):
        raise Error("No paired client subscribes to both garage fields. Open Home before starting.")
    print("Runtime versions:", json.dumps({k: baseline.get(k) for k in ("homebridgeVersion", "hapVersion")}), flush=True)
    print("Keep Home visible throughout. Do not restart Homebridge or change configuration.\n"
          "This changes only internal diagnostic recording. It sends no door/bolt command.\n"
          "The starting recording setting will be restored when the comparison exits.", flush=True)
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
            client.recording(baseline["recording"])
            print("Starting recording setting restored. No state notifications were replayed.", flush=True)
        except Exception:
            print("Could not confirm recording restoration. When all controllers are idle, run:\n" +
                  ("sudo python3 -B scripts/compare-homekit-reporting.py " + ("--restore-recording" if baseline["recording"] else "--restore-baseline") + "\n") +
                  "This affects diagnostics only; garage control is unchanged.", flush=True)


EXPERIMENTS = {
    "events": ("events", "inline", "Event recording only; per-publication subscriber inspection disabled."),
    "subscribers": ("subscribers", "inline", "Subscriber inspection only; no new event history or event timestamps."),
    "deferred": ("off", "deferred", "Garage notifications deferred to setImmediate; internal diagnostics OFF. Bolt publication stays inline."),
    "off": ("off", "inline", "Internal diagnostics OFF with the ordinary inline publisher."),
    "baseline": ("full", "inline", "Full internal diagnostics with the ordinary inline publisher."),
}


def run_experiment(client, controller, name, ask=input):
    trace, publication, description = EXPERIMENTS[name]
    client.stationary(controller)
    baseline = client.snapshot()
    if not all(key in baseline for key in ("traceMode", "publicationMode", "publicationRevision")):
        raise Error("The next experiments require coordinator 0.4.9 or newer.")
    if not subscribers(baseline, controller):
        raise Error("No paired subscriber to both garage fields. Open Home before starting.")
    print("Runtime versions:", json.dumps({k: baseline.get(k) for k in ("homebridgeVersion", "hapVersion")}), flush=True)
    try:
        client.experiment(trace, publication)
        before = client.snapshot()
        if (before.get("traceMode"), before.get("publicationMode")) != (trace, publication) or \
                before["bootId"] != baseline["bootId"] or subscribers(before, controller) != subscribers(baseline, controller):
            raise Error("Process, paired connection or requested experiment changed before the trial.")
        since = max([e.get("sequence", 0) for e in before.get("events", [])] or [0])
        print("\nEXPERIMENT:", name, "—", description, flush=True)
        print("Keep Home visible. Use the indoor button to open fully, then close.\n"
              "After physical closure and bolt locking, watch the tile for 10 seconds.\n"
              "No requests or polling occur while this script waits. No movement commands are sent.\n"
              "Only this one cycle is requested; the starting diagnostic/publication modes will be restored.", flush=True)
        answer = ask("Enter c if Home showed Closed, s if still Closing, or q to stop: ").strip().lower()
        if answer not in ("c", "s"):
            raise Error("Trial stopped by owner.")
        after = client.snapshot()
        show(name, after, controller, since)
        stable = compare_boundary(before, after, controller)
        print("RESULT", json.dumps({"experiment": name, "home": "closed" if answer == "c" else "closing",
              "traceMode": trace, "publicationMode": publication, "sameConnectionAtBoundaries": stable}), flush=True)
        if not stable:
            raise Error("Process, paired subscribers or experiment mode changed; comparison is inconclusive.")
        client.stationary(controller)
        print("Trial recorded. Share this output before selecting another experiment; this result alone does not establish a fix.", flush=True)
    finally:
        try:
            client.experiment(baseline["traceMode"], baseline["publicationMode"])
            print("Starting modes restored. No notifications replayed.", flush=True)
        except Exception:
            print("Could not confirm baseline restoration. When all controllers are idle, run:\n"
                  "sudo python3 -B scripts/compare-homekit-reporting.py --restore-baseline\n"
                  "A coordinator restart restores its version-specific startup defaults.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage", type=Path)
    action = parser.add_mutually_exclusive_group()
    action.add_argument("--restore-recording", action="store_true")
    action.add_argument("--restore-baseline", action="store_true")
    action.add_argument("--experiment", choices=EXPERIMENTS, help="Run one selected follow-up experiment (0.4.9+), then restore baseline")
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
        if args.restore_baseline:
            client.experiment("off", "inline")
            print("Baseline restored: diagnostics OFF, inline publication.")
            return 0
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
        if args.experiment:
            run_experiment(client, controller, args.experiment)
        else:
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
