const { AsyncLocalStorage } = require("node:async_hooks");
if (typeof globalThis.AsyncLocalStorage === "undefined") {
  globalThis.AsyncLocalStorage = AsyncLocalStorage;
}
