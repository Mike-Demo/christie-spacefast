import {
  HeadContent,
  Outlet,
  createRootRoute,
  createRouter,
  type AnyRoute,
} from "@tanstack/react-router";

import { Route as indexFileRoute } from "../routes/index";
import { Route as editorFileRoute } from "../routes/editor";
import { Route as connectFileRoute } from "../routes/connect";
import { Route as authFileRoute } from "../routes/auth";
import { Route as docsFileRoute } from "../routes/docs";
import { Route as licensesFileRoute } from "../routes/licenses";
import { Route as privacyFileRoute } from "../routes/privacy";
import { Route as termsFileRoute } from "../routes/terms";
import { Route as healthFileRoute } from "../routes/health";

function RootComponent() {
  return (
    <>
      <HeadContent />
      {/* Private analytics (same tracker as production). */}
      <script
        defer
        src="https://umami-lite.view.fast/tracker.js"
        data-website-id="8e217b11-3fa3-43c1-b7f6-a3b3b44db66e"
      />
      <Outlet />
    </>
  );
}

function NotFoundComponent() {
  return (
    <main style={{ padding: "3rem 1.5rem", maxWidth: "40rem", margin: "0 auto" }}>
      <h1>Page not found</h1>
      <p>The page you asked for does not exist in this preview.</p>
      <p>
        <a href="/">Back to the homepage</a>
      </p>
    </main>
  );
}

const rootRoute = createRootRoute({
  // Belt and braces: spa.html already carries this statically.
  head: () => ({
    meta: [{ name: "robots", content: "noindex, nofollow" }],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

/**
 * The route files use `createFileRoute(...)`, which leaves `id`/`path`
 * unset without the Start codegen. `update()` stamps the id/path so the
 * route (and its bound `Route.useSearch()` / `Route.useNavigate()` APIs)
 * works in this hand-built tree.
 */
function adopt(
  fileRoute: { update: (opts: Record<string, unknown>) => AnyRoute },
  id: string,
  path: string,
): AnyRoute {
  return fileRoute.update({ id, path, getParentRoute: () => rootRoute });
}

const routeTree = rootRoute.addChildren([
  adopt(indexFileRoute, "/", "/"),
  adopt(editorFileRoute, "/editor", "/editor"),
  adopt(connectFileRoute, "/connect", "/connect"),
  adopt(authFileRoute, "/auth", "/auth"),
  adopt(docsFileRoute, "/docs", "/docs"),
  adopt(licensesFileRoute, "/licenses", "/licenses"),
  adopt(privacyFileRoute, "/privacy", "/privacy"),
  adopt(termsFileRoute, "/terms", "/terms"),
  adopt(healthFileRoute, "/health", "/health"),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
