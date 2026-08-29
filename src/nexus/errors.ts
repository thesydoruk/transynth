/**
 * Custom error classes for the NexusModsClient.
 *
 * All errors extend `NexusModsError`, so callers can catch the base class to
 * handle any Nexus-related failure, or catch a specific subclass for finer
 * error handling.
 *
 * Error hierarchy:
 *   NexusModsError (base)
 *     └─ NexusModsGraphQLError   — API returned GraphQL errors in the response body
 *     └─ NexusModsNotFoundError  — requested resource does not exist
 */

/**
 * Base class for all errors thrown by the NexusMods client.
 *
 * Accepts an optional `cause` that is forwarded to `Error.cause` (Node.js
 * ≥ 16.9 / ES2022) for proper stack-chain inspection.
 * `Object.setPrototypeOf` restores the correct prototype chain in TypeScript
 * codebases that target older class-emission modes.
 */
export class NexusModsError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'NexusModsError';
    // Error({ cause }) constructor syntax requires ES2022 lib (target is ES2020).
    // Use Object.defineProperty to attach cause for error chaining portably.
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause, configurable: true, writable: true });
    }
    // Restore prototype chain for reliable instanceof checks after transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when the NexusMods GraphQL API returns one or more errors in the
 * response body alongside an HTTP 200 status.
 *
 * This is the standard GraphQL error-reporting pattern: the transport
 * succeeded but the server-side query execution failed or returned partial
 * errors.
 *
 * The raw `graphqlErrors` array contains whatever objects the server returned
 * in the `errors` field of the response envelope.
 */
export class NexusModsGraphQLError extends NexusModsError {
  /**
   * The raw error objects returned by the GraphQL server in the `errors` field
   * of the response envelope. Useful for logging and debugging.
   */
  public readonly graphqlErrors: unknown[];

  public constructor(message: string, graphqlErrors: unknown[]) {
    super(message);
    this.name = 'NexusModsGraphQLError';
    this.graphqlErrors = graphqlErrors;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a specific resource (game or mod) does not exist on Nexus Mods.
 *
 * Callers can catch this error to distinguish "not found" from other failures
 * without inspecting the message string.
 */
export class NexusModsNotFoundError extends NexusModsError {
  public constructor(message: string) {
    super(message);
    this.name = 'NexusModsNotFoundError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
