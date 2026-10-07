import contextlib
import importlib.util
import io
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("comparison", Path(__file__).resolve().parents[1] / "scripts/compare-homekit-reporting.py")
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)


class FakeClient:
    def __init__(self):
        self.enabled = True
        self.revision = 0
        self.modes = []
        self.connection = "connection-1"
        self.boot = "synthetic-boot"

    def recording(self, enabled):
        self.modes.append(enabled)
        if self.enabled != enabled:
            self.revision += 1
        self.enabled = enabled

    def stationary(self, controller):
        assert controller == "example"

    def snapshot(self):
        return {"schema": 1, "bootId": self.boot, "recording": self.enabled, "recordingRevision": self.revision,
                "tiles": [], "events": [], "clients": [{"id": self.connection, "paired": True, "subscriptions": [
                    {"controllerId": "example", "field": f} for f in ("doorCurrent", "doorTarget")]}]}


class ComparisonTests(unittest.TestCase):
    def run_compare(self, answers):
        client = FakeClient()
        replies = iter(answers)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            comparison.compare(client, "example", lambda _: next(replies))
        return client, output.getvalue()

    def test_on_off_on_only_when_off_fails_and_restores(self):
        client, output = self.run_compare(["c", "s", "c"])
        self.assertEqual(client.modes, [True, False, True, True])
        self.assertIn("ON worked, OFF failed, ON worked", output)
        self.assertTrue(client.enabled)

    def test_two_successes_stop_without_unnecessary_third_cycle(self):
        client, output = self.run_compare(["c", "c"])
        self.assertEqual(client.modes, [True, False, True])
        self.assertIn("both modes worked", output)

    def test_failed_baseline_stops_and_restores(self):
        client, output = self.run_compare(["s"])
        self.assertEqual(client.modes, [True, True])
        self.assertIn("recording ON also failed", output)

    def test_interruption_restores_recording(self):
        client = FakeClient()
        replies = iter(["c"])
        def ask(_):
            try:
                return next(replies)
            except StopIteration:
                raise KeyboardInterrupt()
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(KeyboardInterrupt):
            comparison.compare(client, "example", ask)
        self.assertEqual(client.modes, [True, False, True])

    def test_connection_change_makes_trial_inconclusive(self):
        client = FakeClient()
        def ask(_):
            client.connection = "connection-2"
            return "c"
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(comparison.Error, "inconclusive"):
            comparison.compare(client, "example", ask)
        self.assertTrue(client.enabled)

    def test_restart_mode_change_or_missing_subscriber_invalidates_comparison(self):
        client = FakeClient()
        before = client.snapshot()
        for key, value in [("bootId", "different"), ("recording", False), ("recordingRevision", 3), ("clients", [])]:
            self.assertFalse(comparison.compare_boundary(before, {**before, key: value}, "example"))


if __name__ == "__main__":
    unittest.main()
