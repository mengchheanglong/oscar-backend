"""Offline contract smoke: real pinned Hermes + real OpenAI client + simulated HTTP.

Run with the prepared Hermes Python and AIW_HERMES_ROOT pointing at a clean
pinned checkout. No model credentials, workspace records or network calls.
"""
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

import httpx

TOOLS = [
    {"name": "search_project_evidence", "description": "Search", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}},
    {"name": "calculate_pricing", "description": "Calculate", "parameters": {"type": "object", "properties": {"price": {"type": "number"}, "variableCost": {"type": "number"}, "fixedCost": {"type": "number"}, "units": {"type": "integer"}}, "required": ["price", "variableCost", "fixedCost", "units"]}},
    {"name": "request_task_review", "description": "Draft", "parameters": {"type": "object", "properties": {"decisionId": {"type": "string"}, "title": {"type": "string"}}, "required": ["decisionId", "title"]}},
    {"name": "list_local_folders", "description": "Folders", "parameters": {"type": "object", "properties": {}}},
    {"name": "list_local_files", "description": "Files", "parameters": {"type": "object", "properties": {"folderId": {"type": "string"}}, "required": ["folderId"]}},
    {"name": "search_local_files", "description": "Search files", "parameters": {"type": "object", "properties": {"folderId": {"type": "string"}, "query": {"type": "string"}}, "required": ["folderId", "query"]}},
    {"name": "read_local_file", "description": "Read file", "parameters": {"type": "object", "properties": {"folderId": {"type": "string"}, "path": {"type": "string"}}, "required": ["folderId", "path"]}},
]


class BridgeSmoke(unittest.TestCase):
    def test_actual_hermes_loop_exposes_only_workspace_tools(self):
        self.exercise("deepseek")

    def test_nous_loop_preserves_the_same_tool_boundary(self):
        self.exercise("nous")

    def exercise(self, provider):
        request = {"prompt": "Analyze synthetic pricing and request review.", "context": "Use workspace tools and produce an artifact.", "model": "deepseek-v4-pro", "apiKey": "synthetic-offline-only", "tools": TOOLS}
        if provider == "nous":
            request.update(provider="nous", baseUrl="https://inference-api.nousresearch.com/v1", model="stepfun/step-3.7-flash:free")
        responses = [
            {"id": "1", "result": [{"title": "Synthetic evidence", "sourceId": "synthetic"}]},
            {"id": "2", "result": {"operatingProfit": 50}},
            {"id": "3", "result": {"reviewRequired": True}},
            {"id": "4", "result": [{"id": "synthetic-folder", "name": "source"}]},
            {"id": "5", "result": {"files": ["notes.txt"], "nextOffset": None}},
            {"id": "6", "result": {"matches": [{"path": "notes.txt", "text": "Mercury"}]}},
            {"id": "7", "result": {"text": "Mercury", "citation": "local:synthetic-folder:notes.txt#version:0"}},
        ]
        incoming = io.StringIO("\n".join(json.dumps(v) for v in [request, *responses]) + "\n")
        outgoing = io.StringIO()
        calls = []
        fixtures = [
            ("search_project_evidence", {"query": "pricing"}),
            ("calculate_pricing", {"price": 20, "variableCost": 5, "fixedCost": 100, "units": 10}),
            ("request_task_review", {"decisionId": "9b6bcda4-1f76-4f6b-9d55-7e2167fc7564", "title": "Review pricing"}),
            ("list_local_folders", {}),
            ("list_local_files", {"folderId": "synthetic-folder"}),
            ("search_local_files", {"folderId": "synthetic-folder", "query": "Mercury"}),
            ("read_local_file", {"folderId": "synthetic-folder", "path": "notes.txt"}),
        ]

        def fake_send(_client, http_request, **_kwargs):
            self.assertEqual(http_request.url.host, "inference-api.nousresearch.com" if provider == "nous" else "api.deepseek.com")
            payload = json.loads(http_request.content)
            self.assertEqual(payload["model"], request["model"])
            self.assertEqual({t["function"]["name"] for t in payload.get("tools", [])}, {t["name"] for t in TOOLS})
            calls.append(payload)
            index = len(calls) - 1
            message = {"role": "assistant", "content": "# Synthetic pricing report\nOperating profit: 50. Task pending review."}
            finish = "stop"
            if index < len(fixtures):
                name, args = fixtures[index]
                message = {"role": "assistant", "content": None, "tool_calls": [{"id": f"call_{index}", "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}
                finish = "tool_calls"
            if payload.get("stream"):
                if "tool_calls" in message:
                    message["tool_calls"][0]["index"] = 0
                head = {"id": f"completion_{index}", "object": "chat.completion.chunk", "created": 1, "model": "deepseek-v4-pro"}
                first = {**head, "choices": [{"index": 0, "delta": message, "finish_reason": None}]}
                last = {**head, "choices": [{"index": 0, "delta": {}, "finish_reason": finish}], "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}}
                content = "data: " + json.dumps(first) + "\n\ndata: " + json.dumps(last) + "\n\ndata: [DONE]\n\n"
                return httpx.Response(200, request=http_request, content=content.encode(), headers={"content-type": "text/event-stream"})
            return httpx.Response(200, request=http_request, json={"id": f"completion_{index}", "object": "chat.completion", "created": 1, "model": "deepseek-v4-pro", "choices": [{"index": 0, "message": message, "finish_reason": finish}], "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}})

        spec = importlib.util.spec_from_file_location("aiw_hermes_bridge", Path(__file__).with_name("bridge.py"))
        module = importlib.util.module_from_spec(spec)
        with patch.object(sys, "stdin", incoming), patch.object(sys, "stdout", outgoing), patch("httpx.Client.send", fake_send), patch("requests.sessions.Session.request", side_effect=RuntimeError("External network disabled in smoke")):
            spec.loader.exec_module(module)
            try:
                module.main()
            except Exception:
                sys.stderr.write("Simulated requests: " + str(len(calls)) + "\n")
                sys.stderr.write("Fixture events: " + outgoing.getvalue() + "\n")
                if calls:
                    sys.stderr.write("Transport stream flag: " + str(calls[-1].get("stream")) + "\n")
                raise
        events = [json.loads(line) for line in outgoing.getvalue().splitlines()]
        self.assertEqual([e.get("name") for e in events if e["type"] == "tool"], [name for name, _ in fixtures[:7]])
        self.assertEqual(events[-1]["type"], "result")
        self.assertIn("50", events[-1]["content"])
        self.assertEqual(len(calls), 8)
        # Also exercise the execution guards directly, independent of any upstream
        # rejection of a tool name absent from the advertised schemas.
        denied = sys.modules["run_agent"].handle_function_call("terminal", {"command": "must-not-run"})
        self.assertIn("not permitted", denied)
        denied = sys.modules["tools.registry"].registry.dispatch("terminal", {"command": "must-not-run"})
        self.assertIn("not permitted", denied)


if __name__ == "__main__":
    unittest.main()
