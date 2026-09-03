export function isClientAbort(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { name?: string; message?: string; code?: string };
  return (
    e.name === "AbortError" ||
    e.code === "ECONNRESET" ||
    e.code === "ERR_STREAM_PREMATURE_CLOSE" ||
    e.message === "aborted"
  );
}
