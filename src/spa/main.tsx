import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Root } from "./Root";

const el = document.getElementById("root");
if (!el) throw new Error("Missing #root element");

createRoot(el).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
