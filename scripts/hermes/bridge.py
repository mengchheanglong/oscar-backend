"""Pinned Hermes subprocess. JSON lines are the only output accepted by NestJS.

This is an adapter, not a second API. The parent owns access and tool execution.
Never import personal Hermes profiles, project .env files, or built-in tools.
"""
import contextlib
import io
import json
import logging
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading

REVISION = "b9aa9289a8083f2e9d248ad6837b2938f5ee92d7"
wire_out = sys.stdout
wire_in = sys.stdin


def emit(value):
    wire_out.write(json.dumps(value, ensure_ascii=True) + "\n")
    wire_out.flush()


def main():
    root = Path(os.environ["AIW_HERMES_ROOT"]).resolve()
    revision = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], stderr=subprocess.DEVNULL,
        text=True,
    ).strip()
    if revision != REVISION:
        raise RuntimeError("Unsupported Hermes revision")
    # Reject source modifications. Ignored environment/dependency directories are allowed.
    if subprocess.check_output(
        ["git", "-C", str(root), "status", "--porcelain", "--untracked-files=no"],
        stderr=subprocess.DEVNULL,
    ).strip():
        raise RuntimeError("Hermes source must be clean")
    with tempfile.TemporaryDirectory(prefix="aiw-hermes-", ignore_cleanup_errors=True) as home:
        os.environ["HERMES_HOME"] = home
        os.environ["HERMES_DISABLE_MCP"] = "1"
        os.environ["HERMES_DISABLE_TELEMETRY"] = "1"
        Path(home, "config.yaml").write_text(
            "plugins:\n  enabled: []\nmcp_servers: {}\ntools:\n  tool_search: false\nmemory:\n  memory_enabled: false\n  user_profile_enabled: false\n", encoding="utf-8"
        )
        os.chdir(home)
        sys.path.insert(0, str(root))
        logging.disable(logging.CRITICAL)
        # Hermes can print initialization diagnostics. Discard them, including errors;
        # parent receives safe codes only. Import may read root/.env: reject it explicitly.
        if (root / ".env").exists():
            raise RuntimeError("Runtime checkout must not contain .env")
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            from run_agent import AIAgent
            import run_agent
            from tools.registry import registry
        if "--probe" in sys.argv:
            emit({"type": "ready", "revision": REVISION})
            logging.shutdown()
            return
        request = json.loads(wire_in.readline())
        sequence = 0
        lock = threading.Lock()

        def handler(name):
            def call(args, **_kwargs):
                nonlocal sequence
                with lock:
                    sequence += 1
                    call_id = str(sequence)
                    emit({"type": "tool", "id": call_id, "name": name, "args": args})
                    reply = json.loads(wire_in.readline())
                    if reply.get("id") != call_id:
                        raise RuntimeError("Invalid protocol response")
                    return json.dumps(reply["result"])
            return call

        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            expected = {s["name"] for s in request["tools"]}
            original_dispatch = registry.dispatch

            def guarded_dispatch(name, args, **kwargs):
                if name not in expected:
                    return json.dumps({"error": "Tool not permitted in this workspace run."})
                return original_dispatch(name, args, **kwargs)

            registry.dispatch = guarded_dispatch

            def workspace_dispatch(function_name, function_args, *_args, **_kwargs):
                # Gate before upstream middleware/special built-in handling. Merely
                # hiding schemas does not guarantee unknown calls cannot dispatch.
                return guarded_dispatch(function_name, function_args)

            run_agent.handle_function_call = workspace_dispatch
            for schema in request["tools"]:
                registry.register(name=schema["name"], toolset="ai_workspace", schema=schema,
                                  handler=handler(schema["name"]), check_fn=lambda: True)
            agent = AIAgent(
                provider="custom", api_mode="chat_completions",
                base_url="https://api.deepseek.com", api_key=request["apiKey"],
                model=request["model"], max_iterations=8, max_tokens=3000,
                enabled_toolsets=["ai_workspace"], quiet_mode=True,
                skip_context_files=True, skip_memory=True, skip_background_review=True,
                load_soul_identity=False, save_trajectories=False, session_db=None,
                ephemeral_system_prompt=request["context"],
            )
            agent._persist_disabled = True
            # Fail closed if upstream implicitly enables additional tools.
            actual = {s["function"]["name"] for s in agent.tools}
            if actual != expected:
                raise RuntimeError("Unexpected tool exposure: " + ",".join(sorted(actual)))
            try:
                result = agent.run_conversation(user_message=request["prompt"])
            finally:
                agent.close()
        if result.get("failed") or result.get("completed") is False:
            raise RuntimeError("Hermes run incomplete")
        final = result.get("final_response", "")
        if not isinstance(final, str) or not final.strip() or len(final) > 24000:
            raise RuntimeError("Invalid artifact")
        emit({"type": "result", "content": final})
        logging.shutdown()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        emit({"type": "error", "code": "HERMES_EXECUTION_FAILED"})
        sys.exit(1)
