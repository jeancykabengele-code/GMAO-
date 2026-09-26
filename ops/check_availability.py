#!/usr/bin/env python3
"""Synthetic availability checks for the production frontend and API."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class CheckResult:
    name: str
    url: str
    ok: bool
    status_code: int | None
    elapsed_ms: int
    detail: str


def request_json(
    name: str,
    url: str,
    timeout: float,
    max_seconds: float,
    token: str | None = None,
) -> CheckResult:
    headers = {"Accept": "application/json", "User-Agent": "gmao-availability-monitor/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    started = time.monotonic()
    status_code: int | None = None
    try:
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status_code = response.status
            payload: Any = json.loads(response.read().decode("utf-8"))
        elapsed = time.monotonic() - started
        status_up = isinstance(payload, dict) and payload.get("status") == "UP"
        database_up = name != "database" or payload.get("database") == "UP"
        fast_enough = elapsed <= max_seconds
        ok = status_code == 200 and status_up and database_up and fast_enough
        if not status_up or not database_up:
            detail = "état applicatif inattendu"
        elif not fast_enough:
            detail = f"latence supérieure au seuil de {max_seconds:.1f} s"
        else:
            detail = "UP"
        return CheckResult(name, url, ok, status_code, round(elapsed * 1000), detail)
    except urllib.error.HTTPError as error:
        elapsed = time.monotonic() - started
        error.close()
        return CheckResult(name, url, False, error.code, round(elapsed * 1000), f"HTTP {error.code}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError) as error:
        elapsed = time.monotonic() - started
        reason = getattr(error, "reason", error)
        return CheckResult(name, url, False, status_code, round(elapsed * 1000), str(reason))


def request_frontend(url: str, timeout: float, max_seconds: float) -> CheckResult:
    started = time.monotonic()
    status_code: int | None = None
    try:
        request = urllib.request.Request(
            url,
            headers={"Accept": "text/html", "User-Agent": "gmao-availability-monitor/1.0"},
        )
        with urllib.request.urlopen(request, timeout=timeout) as response:
            status_code = response.status
            body = response.read(4096)
            csp = response.headers.get("Content-Security-Policy", "")
        elapsed = time.monotonic() - started
        fast_enough = elapsed <= max_seconds
        csp_ok = "default-src 'self'" in csp and "object-src 'none'" in csp
        ok = status_code == 200 and bool(body) and csp_ok and fast_enough
        if not body:
            detail = "réponse vide"
        elif not csp_ok:
            detail = "CSP de production absente ou inattendue"
        elif not fast_enough:
            detail = f"latence supérieure au seuil de {max_seconds:.1f} s"
        else:
            detail = "UP"
        return CheckResult("frontend", url, ok, status_code, round(elapsed * 1000), detail)
    except urllib.error.HTTPError as error:
        elapsed = time.monotonic() - started
        error.close()
        return CheckResult("frontend", url, False, error.code, round(elapsed * 1000), f"HTTP {error.code}")
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        elapsed = time.monotonic() - started
        reason = getattr(error, "reason", error)
        return CheckResult("frontend", url, False, status_code, round(elapsed * 1000), str(reason))


def write_summary(results: list[CheckResult], database_configured: bool) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    lines = [
        "## Supervision GMAO",
        "",
        "| Cible | HTTP | Durée | Résultat |",
        "|---|---:|---:|---|",
    ]
    for result in results:
        status = result.status_code if result.status_code is not None else "—"
        verdict = "✅ " + result.detail if result.ok else "❌ " + result.detail
        lines.append(f"| {result.name} | {status} | {result.elapsed_ms} ms | {verdict} |")
    if not database_configured:
        lines.extend(
            [
                "",
                "> ⚠️ La sonde Aiven est inactive : ajouter le secret Actions `GMAO_HEALTH_TOKEN`.",
            ]
        )
    with open(summary_path, "a", encoding="utf-8") as summary:
        summary.write("\n".join(lines) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--frontend-url", required=True)
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--database-url")
    parser.add_argument("--database-token", default=os.environ.get("GMAO_HEALTH_TOKEN", ""))
    parser.add_argument("--timeout", type=float, default=70.0)
    parser.add_argument("--max-frontend-seconds", type=float, default=5.0)
    parser.add_argument("--max-api-seconds", type=float, default=10.0)
    parser.add_argument("--max-database-seconds", type=float, default=5.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    results = [
        request_frontend(args.frontend_url, args.timeout, args.max_frontend_seconds),
        request_json("api", args.api_url, args.timeout, args.max_api_seconds),
    ]
    database_configured = bool(args.database_url and args.database_token)
    if database_configured:
        results.append(
            request_json(
                "database",
                args.database_url,
                args.timeout,
                args.max_database_seconds,
                args.database_token,
            )
        )

    for result in results:
        print(json.dumps(asdict(result), ensure_ascii=False))
    write_summary(results, database_configured)
    return 0 if all(result.ok for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
