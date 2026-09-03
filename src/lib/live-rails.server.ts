// Zero-Fake guard: refuse to mint or move money on sandbox/mock rails.
// Any settlement path must call assertLiveRails() before issuing an instruction.

export type LiveRailStatus = {
  live: boolean;
  reason?: string;
  plaid_env: string;
  plaid_credentials: boolean;
  bluevine_coordinates: boolean;
};

export function liveRailStatus(): LiveRailStatus {
  const plaidEnv = (process.env["PLAID_ENV"] || "production").toLowerCase();
  const plaidCreds = Boolean(
    process.env["PLAID_CLIENT_ID"] && process.env["PLAID_SECRET"],
  );
  const bvCoords = Boolean(
    process.env["BLUEVINE_ROUTING_NUMBER"] && process.env["BLUEVINE_ACCOUNT_NUMBER"],
  );

  const stripeCreds = Boolean(process.env["STRIPE_SECRET_KEY"]);
  if (stripeCreds) {
    return {
      live: true,
      plaid_env: plaidEnv,
      plaid_credentials: plaidCreds,
      bluevine_coordinates: bvCoords,
    };
  }

  if (!plaidCreds && !bvCoords) {
    return {
      live: false,
      reason: "no_live_rail_configured",
      plaid_env: plaidEnv,
      plaid_credentials: plaidCreds,
      bluevine_coordinates: bvCoords,
    };
  }
  if (plaidCreds && !bvCoords && plaidEnv !== "production") {
    return {
      live: false,
      reason: `plaid_env_not_production:${plaidEnv}`,
      plaid_env: plaidEnv,
      plaid_credentials: plaidCreds,
      bluevine_coordinates: bvCoords,
    };
  }
  return {
    live: true,
    plaid_env: plaidEnv,
    plaid_credentials: plaidCreds,
    bluevine_coordinates: bvCoords,
  };
}

/** Throws when the money rails are not production-live. */
export function assertLiveRails(): void {
  const s = liveRailStatus();
  if (!s.live) {
    throw new Error(
      `FATAL: live payment rail missing (${s.reason}). Refusing to execute settlement in mock mode.`,
    );
  }
}
