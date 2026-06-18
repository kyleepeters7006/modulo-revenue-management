import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Radix UI dropdowns (Select, Popover, etc.) use ResizeObserver to position a
// floating panel. When opening a tall list, the observer callback mutates layout
// within the same frame, and the browser emits a benign
// "ResizeObserver loop completed with undelivered notifications" error event.
// The dev runtime-error overlay catches that event and renders a full-screen
// "(unknown runtime error)", which makes the app look like it crashed/restarted.
// Deferring the observer callback to the next animation frame breaks the
// synchronous loop so the notification is never emitted. This must run before
// any ResizeObserver is instantiated.
if (typeof window !== "undefined" && typeof window.ResizeObserver !== "undefined") {
  const NativeResizeObserver = window.ResizeObserver;
  window.ResizeObserver = class extends NativeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      super((entries, observer) => {
        window.requestAnimationFrame(() => {
          callback(entries, observer);
        });
      });
    }
  };
}

createRoot(document.getElementById("root")!).render(<App />);
