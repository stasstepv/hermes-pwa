import json
import importlib
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dashboard.plugin_api import router
from push_common import endpoint_hash, record_pending_approval

_web_server = importlib.import_module("hermes_cli.web_server")
_SESSION_HEADER_NAME = getattr(_web_server, "_SESSION_HEADER_NAME")
_SESSION_TOKEN = getattr(_web_server, "_SESSION_TOKEN")


class PluginPushApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.env = patch.dict(
            os.environ,
            {
                "HERMES_HOME": self.tmp.name,
                "HERMES_PWA_VAPID_PRIVATE_KEY": "",
                "HERMES_PWA_VAPID_PUBLIC_KEY": "",
            },
            clear=False,
        )
        self.env.start()
        self.addCleanup(self.env.stop)
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app, headers={_SESSION_HEADER_NAME: _SESSION_TOKEN})

    def test_sensitive_routes_require_dashboard_auth(self):
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)

        self.assertEqual(client.get("/push/status").status_code, 401)
        self.assertEqual(client.get("/actions/pending").status_code, 401)
        self.assertEqual(client.get("/sessions/messaging-bindings").status_code, 401)
        self.assertEqual(client.get("/backups").status_code, 401)
        self.assertEqual(client.get("/diagnostics").status_code, 401)
        self.assertEqual(client.get("/install-info").status_code, 401)
        self.assertEqual(client.get("/update/check").status_code, 401)

    def test_public_app_routes_remain_open(self):
        with tempfile.TemporaryDirectory() as dist:
            root = Path(dist).resolve()
            (root / "index.html").write_text("<!doctype html><title>Hermes Mobile</title>", encoding="utf-8")
            with patch("dashboard.plugin_api._DIST_ROOT", root):
                app = FastAPI()
                app.include_router(router)
                client = TestClient(app)

                self.assertEqual(client.get("/app/").status_code, 200)

    def test_health_route_is_public_for_external_monitors(self):
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)

        response = client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["ok"], True)

    def test_authenticated_metadata_routes_remain_available(self):
        self.assertEqual(self.client.get("/install-info").status_code, 200)
        self.assertEqual(self.client.get("/diagnostics").status_code, 200)
        self.assertEqual(self.client.get("/health").status_code, 200)

    def test_push_status_gracefully_unavailable_without_sender_or_vapid(self):
        response = self.client.get("/push/status")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertFalse(data["available"])
        self.assertNotIn("HERMES_PWA_VAPID_PRIVATE_KEY", data)
        self.assertEqual(data["subscriptions"], [])

    def test_subscribe_returns_safe_record_and_persists_raw_endpoint_locally(self):
        response = self.client.post(
            "/push/subscribe?profile=default",
            json={
                "label": "iPhone",
                "subscription": {
                    "endpoint": "https://push.example/sub/1",
                    "keys": {"p256dh": "p256", "auth": "auth"},
                },
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["id"], endpoint_hash("https://push.example/sub/1"))
        self.assertNotIn("endpoint", data["subscription"])
        self.assertNotIn("keys", data["subscription"])

        store = Path(self.tmp.name) / "plugins" / "hermes-pwa" / "push_subscriptions.json"
        self.assertTrue(store.exists())
        self.assertIn("https://push.example/sub/1", store.read_text(encoding="utf-8"))

    def test_unsubscribe_is_idempotent(self):
        sub = {
            "endpoint": "https://push.example/sub/1",
            "keys": {"p256dh": "p256", "auth": "auth"},
        }
        self.client.post("/push/subscribe", json={"subscription": sub})
        response = self.client.post("/push/unsubscribe", json={"endpoint": sub["endpoint"]})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        again = self.client.post("/push/unsubscribe", json={"endpoint": sub["endpoint"]})
        self.assertEqual(again.status_code, 200)

    def test_push_status_is_profile_scoped(self):
        self.client.post(
            "/push/subscribe?profile=default",
            json={"subscription": {"endpoint": "https://push.example/sub/default", "keys": {"p256dh": "p", "auth": "a"}}},
        )
        self.client.post(
            "/push/subscribe?profile=work",
            json={"subscription": {"endpoint": "https://push.example/sub/work", "keys": {"p256dh": "p", "auth": "a"}}},
        )

        response = self.client.get("/push/status?profile=default")

        self.assertEqual(response.status_code, 200)
        subscriptions = response.json()["subscriptions"]
        self.assertEqual([sub["profile"] for sub in subscriptions], ["default"])

    def test_push_test_cannot_target_another_profile_subscription(self):
        self.client.post(
            "/push/subscribe?profile=work",
            json={"subscription": {"endpoint": "https://push.example/sub/work", "keys": {"p256dh": "p", "auth": "a"}}},
        )
        sub_id = endpoint_hash("https://push.example/sub/work")

        with patch("dashboard.plugin_api._push_availability", return_value=(True, None)):
            response = self.client.post("/push/test?profile=default", json={"id": sub_id})

        self.assertEqual(response.status_code, 404)

    def test_unsubscribe_cannot_disable_another_profile_subscription(self):
        self.client.post(
            "/push/subscribe?profile=work",
            json={"subscription": {"endpoint": "https://push.example/sub/work", "keys": {"p256dh": "p", "auth": "a"}}},
        )
        sub_id = endpoint_hash("https://push.example/sub/work")

        response = self.client.post("/push/unsubscribe?profile=default", json={"id": sub_id})

        self.assertEqual(response.status_code, 404)
        store = Path(self.tmp.name) / "plugins" / "hermes-pwa" / "push_subscriptions.json"
        records = json.loads(store.read_text(encoding="utf-8"))
        self.assertTrue(records[0]["enabled"])

    def test_push_test_persists_sanitized_last_error(self):
        self.client.post(
            "/push/subscribe?profile=default",
            json={"subscription": {"endpoint": "https://push.example/sub/default-secret-token", "keys": {"p256dh": "p", "auth": "a"}}},
        )
        sub_id = endpoint_hash("https://push.example/sub/default-secret-token")

        with patch("dashboard.plugin_api._push_availability", return_value=(True, None)):
            with patch(
                "dashboard.plugin_api._send_push_record",
                side_effect=RuntimeError("failed https://push.example/sub/default-secret-token token=abc"),
            ):
                response = self.client.post("/push/test?profile=default", json={"id": sub_id})

        self.assertEqual(response.status_code, 502)
        store = Path(self.tmp.name) / "plugins" / "hermes-pwa" / "push_subscriptions.json"
        records = json.loads(store.read_text(encoding="utf-8"))
        self.assertNotIn("https://push.example", records[0]["last_error"])
        self.assertNotIn("abc", records[0]["last_error"])

    def test_pending_actions_returns_persisted_approvals(self):
        record_pending_approval(
            session_key="telegram:123",
            command="rm -rf /tmp/example",
            description="delete in temp",
            pattern_key="rm-rf",
            profile="default",
        )
        response = self.client.get("/actions/pending?profile=default")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["items"][0]["kind"], "approval")
        self.assertEqual(data["items"][0]["session_id"], "telegram:123")

    def test_test_push_requires_available_sender(self):
        response = self.client.post("/push/test", json={"id": "missing"})
        self.assertEqual(response.status_code, 503)


if __name__ == "__main__":
    unittest.main()
