import { createFileRoute } from "@tanstack/react-router";
import Terminal1031 from "@/components/admin/Terminal1031";

export const Route = createFileRoute("/_authenticated/admin/terminal-1031")({
  head: () => ({
    meta: [
      { title: "1031 Commercial Execution Terminal" },
      { name: "description", content: "Live 1031 like-kind commercial asset tape, identification clocks, and autonomous engine telemetry." },
      { property: "og:title", content: "1031 Commercial Execution Terminal" },
      { property: "og:description", content: "Live 1031 like-kind commercial asset tape and autonomous engine telemetry." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: Terminal1031,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 font-mono text-sm">404</div>,
});
