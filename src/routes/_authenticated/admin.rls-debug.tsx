import { createFileRoute } from "@tanstack/react-router";
import { RlsDebugger } from "@/components/admin/RlsDebugger";

export const Route = createFileRoute("/_authenticated/admin/rls-debug")({
  head: () => ({
    meta: [
      { title: "RLS Debugger | Asset Terminal" },
      {
        name: "description",
        content:
          "Run a test insert and read the raw PostgreSQL error code, message, details and hint returned by row level security.",
      },
      { property: "og:title", content: "RLS Debugger | Asset Terminal" },
      {
        property: "og:description",
        content: "Inspect raw PostgreSQL errors from a test insert.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <main className="p-6">
      <h1 className="mb-6 text-2xl font-semibold">RLS Debugger</h1>
      <RlsDebugger />
    </main>
  ),
});
