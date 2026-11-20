/**
 * How API requests reach studyPal's route handlers. On the desktop they go
 * over HTTP to the local server (the default); the phone has no server and
 * sets a transport that calls the handlers in-process.
 */
export type Transport = (path: string, init?: RequestInit) => Promise<Response>;

let transport: Transport = (path, init) => fetch(path, init);

export function setTransport(next: Transport): void {
  transport = next;
}

/** Sends a request for an API path such as `/api/events`. */
export function request(path: string, init?: RequestInit): Promise<Response> {
  return transport(path, init);
}
