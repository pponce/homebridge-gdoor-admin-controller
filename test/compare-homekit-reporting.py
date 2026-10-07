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
        self.trace = "full"
        self.publication = "inline"
        self.publication_revision = 0
        self.experiments = []
        self.requests = 0

    def recording(self, enabled):
        self.modes.append(enabled)
        if self.enabled != enabled:
            self.revision += 1
        self.enabled = enabled

    def stationary(self, controller):
        self.requests += 1
        assert controller == "example"

    def experiment(self, trace, publication):
        self.requests += 1
        self.experiments.append((trace, publication))
        if self.trace != trace:
            self.revision += 1
        if self.publication != publication:
            self.publication_revision += 1
        self.trace, self.publication, self.enabled = trace, publication, trace != "off"

    def snapshot(self):
        self.requests += 1
        return {"schema": 1, "bootId": self.boot, "recording": self.enabled, "recordingRevision": self.revision,
                "traceMode": self.trace, "publicationMode": self.publication, "publicationRevision": self.publication_revision,
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
        for key, value in [("bootId", "different"), ("recording", False), ("recordingRevision", 3), ("clients", []),
                           ("traceMode", "events"), ("publicationMode", "deferred"), ("publicationRevision", 4)]:
            self.assertFalse(comparison.compare_boundary(before, {**before, key: value}, "example"))

    def test_each_experiment_requests_one_cycle_without_polling_then_restores_baseline(self):
        for name, (trace, publication, _) in comparison.EXPERIMENTS.items():
            for answer in ("c", "s"):
                client = FakeClient()
                prompts = []
                def ask(prompt):
                    prompts.append(prompt)
                    self.assertEqual(client.experiments, [(trace, publication)])
                    self.assertEqual(client.requests, 4)  # stationary, snapshot, switch, snapshot; then wait
                    return answer
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    comparison.run_experiment(client, "example", name, ask)
                self.assertEqual(len(prompts), 1)
                self.assertEqual(client.experiments, [(trace, publication), ("full", "inline")])
                self.assertEqual(client.publication, "inline")
                self.assertTrue(client.enabled)
                self.assertIn('"sameConnectionAtBoundaries": true', output.getvalue())

    def test_experiment_interrupt_and_inconclusive_results_restore_baseline(self):
        for failure in ("interrupt", "connection", "mode", "quit"):
            client = FakeClient()
            def ask(_):
                if failure == "interrupt":
                    raise KeyboardInterrupt()
                if failure == "connection":
                    client.connection = "connection-2"
                if failure == "mode":
                    client.publication_revision += 1
                return "q" if failure == "quit" else "c"
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises((KeyboardInterrupt, comparison.Error)):
                comparison.run_experiment(client, "example", "deferred", ask)
            self.assertEqual(client.experiments[-1], ("full", "inline"))

    def test_failed_restoration_prints_recovery_command(self):
        client = FakeClient()
        original = client.experiment
        def experiment(trace, publication):
            if trace == "full":
                raise comparison.Error("unavailable")
            original(trace, publication)
        client.experiment = experiment
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            comparison.run_experiment(client, "example", "deferred", lambda _: "c")
        self.assertIn("Could not confirm baseline restoration", output.getvalue())
        self.assertIn("--restore-baseline", output.getvalue())

    def test_off_start_is_restored_after_experiment_and_comparison(self):
        for experiment in (True, False):
            client = FakeClient()
            client.experiment("off", "inline")
            with contextlib.redirect_stdout(io.StringIO()):
                if experiment:
                    comparison.run_experiment(client, "example", "events", lambda _: "c")
                else:
                    comparison.compare(client, "example", lambda _: "c")
            self.assertFalse(client.enabled)

    def test_older_runtime_and_missing_subscriptions_do_not_start_experiments(self):
        for missing in ("traceMode", "clients"):
            client = FakeClient()
            original = client.snapshot
            def snapshot():
                result = original()
                del result[missing]
                return result
            client.snapshot = snapshot
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(comparison.Error):
                comparison.run_experiment(client, "example", "events", lambda _: self.fail("must not request movement"))
            self.assertEqual(client.experiments, [])


if __name__ == "__main__":
    unittest.main()
