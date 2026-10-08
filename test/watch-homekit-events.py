import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import contextlib
import io

spec = importlib.util.spec_from_file_location("capture", Path(__file__).resolve().parents[1] / "scripts/watch-homekit-events.py")
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)


class CaptureTests(unittest.TestCase):
    def test_reporting_view_excludes_unrelated_fields_and_uses_anonymous_garage_names(self):
        view = capture.reporting_view({"tiles": [{"controllerId": "private-id", "kind": "garage", "available": True,
            "private": "SECRET", "fields": [{"field": "doorCurrent", "cached": 1, "reported": 1, "secret": "SECRET"}]}],
            "clients": [{"id": "connection-1", "paired": True, "username": "SECRET", "subscriptions": [
                {"controllerId": "private-id", "field": "doorCurrent"}, {"controllerId": "unrelated", "field": "private"}]}]},
            {"private-id": "Garage 1"})
        self.assertNotIn("SECRET", json.dumps(view))
        self.assertNotIn("private-id", json.dumps(view))
        self.assertEqual(view["clients"][0]["subscriptions"], [{"garage": "Garage 1", "field": "doorCurrent"}])

    def test_reporting_mode_only_reads_management_and_does_not_subscribe_to_hap(self):
        snapshot = {"reporting": {"schema": 1, "tiles": [], "clients": [], "events": []}}
        output = io.StringIO()
        with patch.object(capture, "get_json", return_value=snapshot) as request, \
             patch.object(capture.time, "monotonic", side_effect=[0, 0, 0, 0, 2]), \
             patch.object(capture.time, "sleep"), contextlib.redirect_stdout(output):
            capture.watch_reporting(12345, "PRIVATE-TOKEN", [], 1)
        request.assert_called_once_with(12345, "/v1/homekit-reporting", "PRIVATE-TOKEN")
        self.assertNotIn("PRIVATE-TOKEN", output.getvalue())

    def test_fragmented_ack_and_multiple_characteristics_in_one_event(self):
        payload = {"characteristics": [{"aid": 2, "iid": 10, "value": 1}, {"aid": 3, "iid": 12, "value": 1}]}
        body = json.dumps(payload).encode()
        data = b"HTTP/1.1 204 No Content\r\n\r\nEVENT/1.0 200 OK\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body
        frames = capture.Frames()
        result = []
        for byte in data:
            result.extend(frames.feed(bytes([byte])))
        self.assertEqual(result, [("HTTP/1.1", 204, {}), ("EVENT/1.0", 200, payload)])

    def test_oversized_or_ambiguous_frames_fail(self):
        for data in [b"X" * 8193,
                     b"EVENT/1.0 200 OK\r\nContent-Length: -1\r\n\r\n",
                     b"EVENT/1.0 200 OK\r\nContent-Length: 9999999\r\n\r\n",
                     b"EVENT/1.0 200 OK\r\nContent-Length: 0\r\nContent-Length: 2\r\n\r\n{}"]:
            with self.assertRaises(capture.CaptureError):
                capture.Frames().feed(data)

    def test_only_coordinator_tiles_selected_with_short_or_full_uuids(self):
        def accessory(aid, serial, kind):
            return {"aid": aid, "services": [
                {"type": "3E", "characteristics": [{"type": "30", "value": serial}]},
                {"type": "41" if kind == "garage" else "45", "characteristics": [
                    {"type": t, "iid": i + 10, "perms": ["pr", "ev"]}
                    for i, t in enumerate(("0000000E-0000-1000-8000-0026BB765291", "32") if kind == "garage" else ("1D", "1E"))]}]}
        selected = capture.select_tiles({"accessories": [accessory(2, "example-garage", "garage"),
                                        accessory(3, "example-bolt", "bolt"), accessory(4, "another-garage", "garage")]}, [{"id": "example"}])
        self.assertEqual(selected, {(2, 10): ("Garage 1", "doorCurrent"), (2, 11): ("Garage 1", "doorTarget"),
                                   (3, 10): ("Garage 1", "boltCurrent"), (3, 11): ("Garage 1", "boltTarget")})


if __name__ == "__main__":
    unittest.main()
