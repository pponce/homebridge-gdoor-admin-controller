#!/usr/bin/env python3
"""Observe local HAP push events. Never write a characteristic value or operate hardware."""
import argparse
import http.client
import json
from pathlib import Path
import select
import socket
import time


class CaptureError(Exception):
    pass


def get_json(port, endpoint, authorization):
    connection = http.client.HTTPConnection("127.0.0.1", int(port), timeout=3)
    try:
        connection.request("GET", endpoint, headers={"Authorization": authorization})
        response = connection.getresponse()
        if response.status != 200:
            raise CaptureError("Local read rejected (HTTP %d)." % response.status)
        data = response.read(1048577)
        if len(data) > 1048576:
            raise CaptureError("Local response exceeded the capture limit.")
        return json.loads(data)
    finally:
        connection.close()


class Frames:
    """Parse fragmented/coalesced HTTP and HAP EVENT frames on one connection."""
    def __init__(self):
        self.buffer = b""

    def feed(self, data):
        self.buffer += data
        if len(self.buffer) > 1048576:
            raise CaptureError("Event buffer exceeded the capture limit.")
        result = []
        while self.buffer:
            end = self.buffer.find(b"\r\n\r\n")
            if end < 0:
                if len(self.buffer) > 8192:
                    raise CaptureError("Invalid event header.")
                break
            if end > 8192:
                raise CaptureError("Invalid event header.")
            lines = self.buffer[:end].decode("ascii").split("\r\n")
            parts = lines[0].split(" ")
            if len(parts) < 2 or parts[0] not in ("HTTP/1.1", "EVENT/1.0"):
                raise CaptureError("Invalid event response.")
            headers = {}
            for line in lines[1:]:
                key, value = line.split(":", 1)
                key = key.strip().lower()
                if key in headers:
                    raise CaptureError("Duplicate event header.")
                headers[key] = value.strip()
            status = int(parts[1])
            if "transfer-encoding" in headers or (status != 204 and "content-length" not in headers):
                raise CaptureError("Unsupported event framing.")
            length = int(headers.get("content-length", "0"))
            if not 0 <= length <= 524288:
                raise CaptureError("Invalid event size.")
            stop = end + 4 + length
            if len(self.buffer) < stop:
                break
            body = self.buffer[end + 4:stop]
            self.buffer = self.buffer[stop:]
            result.append((parts[0], status, json.loads(body) if body else {}))
        return result


def short_type(value):
    return value.upper().split("-")[0].lstrip("0") or "0"


def select_tiles(accessories, controllers):
    serials = {p["id"] + "-" + kind: ("Garage %d" % (index + 1), kind)
               for index, p in enumerate(controllers) for kind in ("garage", "bolt")}
    selected = {}
    for accessory in accessories["accessories"]:
        serial = next((c.get("value") for s in accessory["services"]
                       if short_type(s["type"]) == "3E" for c in s["characteristics"]
                       if short_type(c["type"]) == "30"), None)
        if serial not in serials:
            continue
        label, kind = serials[serial]
        fields = {"E": "doorCurrent", "32": "doorTarget"} if kind == "garage" else {"1D": "boltCurrent", "1E": "boltTarget"}
        for service in accessory["services"]:
            if short_type(service["type"]) != ("41" if kind == "garage" else "45"):
                continue
            for characteristic in service["characteristics"]:
                field = fields.get(short_type(characteristic["type"]))
                if field:
                    if "ev" not in characteristic.get("perms", []):
                        raise CaptureError("A selected characteristic does not support events.")
                    selected[(accessory["aid"], characteristic["iid"])] = (label, field)
    if not selected:
        raise CaptureError("No coordinator tiles found on the configured bridge.")
    return selected


def value_label(field, value):
    values = ({0: "open", 1: "closed", 2: "opening", 3: "closing", 4: "stopped"}
              if field.startswith("door") else {0: "unlocked", 1: "locked", 2: "jammed", 3: "unknown"})
    return values.get(value, "unknown")


def reporting_view(snapshot, labels):
    """Project only this diagnostic's documented fields; never print raw responses."""
    tiles = []
    for tile in snapshot.get("tiles", []):
        if tile.get("controllerId") not in labels:
            continue
        fields = []
        for row in tile.get("fields", []):
            field = row.get("field")
            if field not in ("doorCurrent", "doorTarget", "boltCurrent", "boltTarget", "obstruction"):
                continue
            fields.append({key: row.get(key) for key in ("field", "reported", "cached", "status", "supportsEvents", "subscribers")})
        tiles.append({"garage": labels[tile["controllerId"]], "kind": tile.get("kind"),
                      "available": tile.get("available"), "fields": fields})
    clients = []
    for client in snapshot.get("clients", []):
        row = {key: client.get(key) for key in ("id", "paired", "requestInProgress", "writtenBytes", "socketWritable")}
        for key in ("subscriptions", "queued"):
            row[key] = [{"garage": labels[item["controllerId"]], "field": item.get("field"),
                         **({"value": item.get("value")} if key == "queued" else {})}
                        for item in client.get(key, []) if item.get("controllerId") in labels]
        clients.append(row)
    return {"connectionInspection": snapshot.get("connectionInspection"), "truncated": snapshot.get("truncated"),
            "tiles": tiles, "clients": clients}


def watch_reporting(port, authorization, controllers, seconds):
    labels = {p["id"]: "Garage %d" % (i + 1) for i, p in enumerate(controllers)}
    started = time.monotonic()
    previous = None
    sequence = None
    print("READY: keep Home open and test one indoor-button open/close cycle.\n"
          "If Home stays Closing, wait 10 seconds, then leave and re-enter Home once.\n"
          "Observing existing HomeKit connections only; no new HAP subscriber or movement command.", flush=True)
    while time.monotonic() - started < seconds:
        response = get_json(port, "/v1/homekit-reporting", authorization)
        snapshot = response["reporting"]
        if snapshot.get("schema") != 1:
            raise CaptureError("Unsupported reporting diagnostic.")
        if sequence is None:
            print("Runtime versions:", json.dumps({key: snapshot.get(key) for key in ("homebridgeVersion", "hapVersion")}), flush=True)
            sequence = max([e.get("sequence", 0) for e in snapshot.get("events", [])] or [0])
        view = reporting_view(snapshot, labels)
        if view != previous:
            print("%7.2fs REPORT %s" % (time.monotonic() - started, json.dumps(view)), flush=True)
            previous = view
        for event in snapshot.get("events", []):
            if event.get("sequence", 0) <= sequence:
                continue
            sequence = event["sequence"]
            if event.get("controllerId") not in labels:
                continue
            row = {key: event.get(key) for key in ("kind", "field", "value", "explicit", "client", "subscribers") if key in event}
            row["garage"] = labels[event["controllerId"]]
            print("%7.2fs TRACE  %s" % (time.monotonic() - started, json.dumps(row)), flush=True)
        time.sleep(min(1, max(0, seconds - (time.monotonic() - started))))


def watch(storage, seconds, reporting=False):
    root = storage / "gdoorandbolt-coordinator"
    saved = json.loads((root / "profiles.json").read_text())
    identity = json.loads((root / "identity.json").read_text())
    config = json.loads((storage / "config.json").read_text())
    platforms = [p for p in config.get("platforms", []) if p.get("platform") == "GDoorAndBoltCoordinator"]
    if len(platforms) != 1:
        raise CaptureError("Expected one coordinator platform in this Homebridge storage.")
    platform = platforms[0]
    management_port = platform.get("managementPort") or 27773
    authorization = "Bearer " + identity["token"]
    controllers = saved["configuration"]["controllers"]
    info = get_json(management_port, "/v1/identity", authorization)
    print("Running version:", info.get("pluginVersion", "unknown"), flush=True)
    if reporting:
        try:
            watch_reporting(management_port, authorization, controllers, seconds)
        except KeyboardInterrupt:
            pass
        return
    bridge = {**config["bridge"], **platform.get("_bridge", {})}
    port, pin = bridge["port"], bridge["pin"]
    # Only one HAP read, to discover IDs. No polling of HAP values during capture:
    # reading them repeatedly could hide the missing-push problem under investigation.
    selected = select_tiles(get_json(port, "/accessories", pin), controllers)
    body = json.dumps({"characteristics": [{"aid": aid, "iid": iid, "ev": True}
                                           for aid, iid in selected]}).encode("ascii")
    if "\r" in pin or "\n" in pin:
        raise CaptureError("Invalid local bridge PIN.")
    request = ("PUT /characteristics HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n"
               "Authorization: %s\r\nContent-Type: application/hap+json\r\n"
               "Connection: keep-alive\r\nContent-Length: %d\r\n\r\n" % (port, pin, len(body))).encode("ascii") + body
    frames = Frames()
    previous = {}
    counts = {key: 0 for key in selected}
    started = time.monotonic()
    next_poll = started
    ready = False

    def output(kind, payload):
        print("%7.2fs %-8s %s" % (time.monotonic() - started, kind, json.dumps(payload)), flush=True)

    with socket.create_connection(("127.0.0.1", port), timeout=3) as connection:
        connection.sendall(request)
        try:
            while time.monotonic() - started < seconds:
                readable, _, _ = select.select([connection], [], [], 0.2)
                if readable:
                    data = connection.recv(65536)
                    if not data:
                        raise CaptureError("Homebridge closed the event connection.")
                    for protocol, status, payload in frames.feed(data):
                        if protocol == "HTTP/1.1":
                            if status not in (200, 204, 207) or any(c.get("status", 0) != 0 for c in payload.get("characteristics", [])):
                                raise CaptureError("Homebridge rejected the event subscription (HTTP %d)." % status)
                            ready = True
                            print("READY: keep Home open; use the indoor button for one open/close cycle.\n"
                                  "Capturing pushed events for %d seconds; Ctrl+C stops. No movement commands are sent." % seconds, flush=True)
                        elif status == 200:
                            for row in payload.get("characteristics", []):
                                key = (row.get("aid"), row.get("iid"))
                                if key in selected:
                                    label, field = selected[key]
                                    counts[key] += 1
                                    output("PUSH", {"garage": label, field: value_label(field, row.get("value"))})
                if not ready and time.monotonic() - started > 5:
                    raise CaptureError("Homebridge did not acknowledge the event subscription.")
                if ready and time.monotonic() >= next_poll:
                    for index, controller in enumerate(controllers):
                        status = get_json(management_port, "/v1/controllers/" + controller["id"] + "/state", authorization)["status"]
                        state = {k: status["state"].get(k) for k in ("phase", "door", "bolt", "target", "busy", "fault", "unavailable")}
                        state["enabled"] = status["actuationEnabled"]
                        label = "Garage %d" % (index + 1)
                        if previous.get(label) != state:
                            output("ENGINE", {"garage": label, **state})
                            previous[label] = state
                    next_poll = time.monotonic() + 1
        except KeyboardInterrupt:
            pass
        finally:
            for key, count in counts.items():
                label, field = selected[key]
                output("TOTAL", {"garage": label, "field": field, "pushes": count})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--storage", type=Path, help="Homebridge storage directory (auto-detected by default)")
    parser.add_argument("--seconds", type=int, default=180)
    parser.add_argument("--reporting", action="store_true", help="Read the plugin's paired-connection diagnostic instead of creating a HAP subscriber (0.4.7+)")
    args = parser.parse_args()
    try:
        if not 10 <= args.seconds <= 600:
            raise CaptureError("Capture duration must be between 10 and 600 seconds.")
        if args.storage:
            storage = args.storage.resolve()
        else:
            roots = {p.resolve() for p in (Path("/var/lib/homebridge"), Path("/home/homebridge/.homebridge"))
                     if (p / "gdoorandbolt-coordinator/profiles.json").is_file()}
            if len(roots) != 1:
                raise CaptureError("Storage was not uniquely detected; supply --storage.")
            storage = roots.pop()
        watch(storage, args.seconds, args.reporting)
    except CaptureError as error:
        print("Capture stopped:", str(error), flush=True)
        return 1
    except Exception as error:
        # Raw connection/JSON errors may include sensitive configuration content.
        print("Capture stopped (%s); no credentials printed." % type(error).__name__, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
