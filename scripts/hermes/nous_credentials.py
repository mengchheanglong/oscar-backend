"""Credential-only broker. Never import this Hermes install's agent/tools.

The parent owns the output pipe. Only an ephemeral invocation credential crosses
it; OAuth refresh credentials stay in the signed-in installation's auth store.
"""
import contextlib
import io
import json
import os
from pathlib import Path
import sys


def main():
    request = json.loads(sys.stdin.readline())
    model = request.get("model", "")
    if not isinstance(model, str) or not model.endswith(":free"):
        raise ValueError("free_model")
    root = Path(os.environ["OSCAR_HERMES_AUTH_ROOT"]).resolve()
    sys.path.insert(0, str(root))
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        import hermes_bootstrap  # noqa: F401 — prepare the installed auth dependencies
        from hermes_cli.runtime_provider import resolve_runtime_provider
        from hermes_cli.anon_challenge import background_caller
        import httpx
        # Live public free-model list: a removed promotion fails closed, without
        # silently trying another model or a paid provider.
        response = httpx.get("https://portal.nousresearch.com/api/nous/recommended-models", timeout=10, follow_redirects=False)
        response.raise_for_status()
        free = {row.get("modelName") for row in response.json().get("freeRecommendedModels", []) if isinstance(row, dict)}
        if model not in free:
            raise ValueError("free_model")
        with background_caller():
            runtime = resolve_runtime_provider(requested="nous", target_model=model)
        if runtime.get("provider") != "nous" or runtime.get("base_url", "").rstrip("/") != "https://inference-api.nousresearch.com/v1":
            raise RuntimeError("auth")
        token = runtime.get("api_key")
        if not isinstance(token, str) or not token:
            raise RuntimeError("auth")
    return {"provider": "nous", "model": model, "baseUrl": "https://inference-api.nousresearch.com/v1", "apiKey": token}


if __name__ == "__main__":
    try:
        print(json.dumps(main()))
    except Exception as error:
        code = "HERMES_NOUS_FREE_MODEL_UNAVAILABLE" if isinstance(error, ValueError) and str(error) == "free_model" else "HERMES_NOUS_AUTH_REQUIRED"
        print(json.dumps({"error": code}))
        sys.exit(1)
