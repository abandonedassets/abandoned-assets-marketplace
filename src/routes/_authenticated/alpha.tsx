import { createFileRoute } from "@tanstack/react-router";
import AlphaStreamLedger from "@/components/AlphaStreamLedger";

export const Route = createFileRoute("/_authenticated/alpha")({
  head: () => ({
    meta: [
      { title: "Alpha Stream Ledger" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AlphaStreamLedger,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="p-6 font-mono text-sm">404 :: no records</div>
  ),
});
