import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Studio } from "@/routes/index.tsx";
import { OutputPage } from "@/routes/output.tsx";
import { Remote } from "@/routes/remote.tsx";
import "@/styles.css";

const queryClient = new QueryClient();

/** The desktop build has no server, so pick the screen from the address directly. */
function App() {
  const path = window.location.pathname;
  if (path.startsWith("/output")) return <OutputPage />;
  if (path.startsWith("/remote")) return <Remote />;
  return <Studio />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
