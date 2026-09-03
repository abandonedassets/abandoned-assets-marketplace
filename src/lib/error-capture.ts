// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

import { isClientAbort } from "./is-client-abort";

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 5_000;

function record(error: unknown) {
  // Client disconnects ("aborted" / AbortError) are not app failures.
  if (isClientAbort(error)) return;
  lastCapturedError = { error, at: Date.now() };
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}

// Node-level: swallow client-disconnect noise ("aborted", AbortError) only.
const proc = (globalThis as { process?: NodeJS.Process }).process;
if (proc && typeof proc.on === "function") {
  proc.on("uncaughtException", (error) => {
    if (isClientAbort(error)) return;
    record(error);
    console.error("[fatal:uncaughtException]", error);
    proc.exitCode = 1;
  });
  proc.on("unhandledRejection", (reason) => {
    if (isClientAbort(reason)) return;
    record(reason);
    console.error("[fatal:unhandledRejection]", reason);
    proc.exitCode = 1;
  });
  proc.on("beforeExit", (code) => {
    console.error(`[process:beforeExit] code=${code}`);
  });
  proc.on("exit", (code) => {
    console.error(`[process:exit] code=${code}`);
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    proc.on(signal, () => {
      console.error(`[process:signal] signal=${signal}`);
      proc.exitCode = 0;
    });
  }
}
