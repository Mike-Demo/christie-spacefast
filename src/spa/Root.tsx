import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";

import { router } from "./router";

const queryClient = new QueryClient();

/** SPA root: query client + router. Route components are reused from src/routes. */
export function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
