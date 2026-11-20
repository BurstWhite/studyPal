/**
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { setChatOpener } from "@studypal/client/chat/pendingPrompt";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { startTheme } from "./app/theme";

// Before the first render, so the app never paints in the wrong theme.
startTheme();

// Pages that hand a prompt to the chat (e.g. "生成计划") switch to it this way.
setChatOpener(() => {
  window.location.hash = "#/chat";
});

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// https://bun.com/docs/bundler/hot-reloading#import-meta-hot-data
type HotData = { root?: Root };
((import.meta.hot.data as HotData).root ??= createRoot(elem)).render(app);
