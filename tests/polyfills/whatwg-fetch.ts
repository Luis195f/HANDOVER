// Minimal polyfill shim for environments where fetch is already available.
// Node 20 includes fetch/Request/Response globally, so we simply ensure the
// module can be imported without side effects.
export {};
