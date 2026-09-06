/**
 * The seam between an adapter and a service it does not own.
 *
 * Every adapter in this package takes a transport rather than building one.
 * That is the difference between a client and an integration: the client is
 * real and tested here, and whether it is pointed at a running service, a
 * recorded fixture, or nothing at all is the caller's decision and is visible
 * in the caller's code.
 *
 * It matters for honesty as much as for testing. A conformance suite that runs
 * against a fixture proves the adapter speaks the contract; it proves nothing
 * about a service being reachable, and an adapter that opened its own
 * connection would blur those two claims together.
 *
 * **Credentials never pass through here.** A transport is constructed by
 * server-side code that already holds whatever it needs. An adapter has no
 * parameter for a token, so there is no path by which a request body, a
 * configuration cell or a model could supply one.
 */

export interface TransportRequest {
  method: "GET" | "POST";
  /** Path only. An adapter never chooses a host. */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export interface TransportResponse {
  status: number;
  body: unknown;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

/** Every way a call can fail that is not the service answering normally. */
export type AdapterFailureKind =
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "unavailable"
  | "malformed"
  | "timeout";

export class AdapterError extends Error {
  readonly kind: AdapterFailureKind;
  readonly status: number | undefined;
  /** The service and path, for a log. Never the body, which may be untrusted. */
  readonly at: string;

  constructor(kind: AdapterFailureKind, message: string, at: string, status?: number) {
    super(message);
    this.name = "AdapterError";
    this.kind = kind;
    this.at = at;
    this.status = status;
  }
}

/**
 * Turns a status code into a failure kind.
 *
 * `unauthorized` and `forbidden` stay distinct from `not-found`, and all three
 * stay distinct from `unavailable`, because R06 and R25 both turn on telling
 * "you may not see this" apart from "this does not exist" apart from "the
 * service is down". Collapsing them into one error is how a denial gets
 * reported to a user as missing data.
 */
export function classify(status: number, at: string): AdapterError | undefined {
  if (status >= 200 && status < 300) return undefined;
  if (status === 401) return new AdapterError("unauthorized", `${at} refused the identity`, at, status);
  if (status === 403) return new AdapterError("forbidden", `${at} denied access to this scope`, at, status);
  if (status === 404) return new AdapterError("not-found", `${at} has no such object`, at, status);
  if (status === 408 || status === 504) return new AdapterError("timeout", `${at} did not answer in time`, at, status);
  if (status >= 500) return new AdapterError("unavailable", `${at} is unavailable`, at, status);
  return new AdapterError("malformed", `${at} answered with status ${status}`, at, status);
}

/** A transport that fails every call, for a caller that has not configured one. */
export const unconfigured: Transport = async (request) => {
  throw new AdapterError(
    "unavailable",
    `no transport is configured for ${request.path}`,
    request.path,
  );
};

/**
 * Wraps a transport with a deadline and a bounded response size (R24, R04).
 *
 * A service this code does not own is exactly the thing that can hang or
 * answer with a hundred megabytes, and neither is something a caller should
 * have to remember to guard against at every call site.
 */
export interface BoundOptions {
  /** Milliseconds before a call is abandoned. Default 10000. */
  timeoutMs?: number;
  /** Longest JSON body accepted, in characters. Default 4 MB. */
  maxBodyChars?: number;
}

export function bounded(inner: Transport, options: BoundOptions = {}): Transport {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBodyChars = options.maxBodyChars ?? 4 * 1024 * 1024;

  return async (request) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new AdapterError(
              "timeout",
              `${request.path} did not answer within ${timeoutMs}ms`,
              request.path,
            ),
          ),
        timeoutMs,
      );
    });

    try {
      const response = await Promise.race([inner(request), deadline]);
      const size = JSON.stringify(response.body ?? null).length;
      if (size > maxBodyChars) {
        throw new AdapterError(
          "malformed",
          `${request.path} answered with ${size} characters, over the ${maxBodyChars} limit`,
          request.path,
        );
      }
      return response;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}
