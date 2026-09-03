import { createFileRoute } from "@tanstack/react-router";
import AlphaStreamTerminal from "@/components/AlphaStreamTerminal";

export const Route = createFileRoute("/_authenticated/admin/terminal")({
  head: () => ({
    meta: [
      { title: "Alpha Stream Terminal" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: AlphaStreamTerminal,
  errorComponent: ({ error }) => (
    <div className="p-6 font-mono text-sm text-destructive">ERR :: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6 font-mono text-sm">404</div>,
});
