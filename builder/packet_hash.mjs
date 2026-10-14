/* The fields that define what gets posted, hashed the same way HQ's Approve button does (see approvals.js). */
import crypto from "node:crypto";
export const HASH_FIELDS = ["type", "fileno", "script", "caption", "pinned", "locPlace", "locCountry", "look"];
export function packetHash(p) {
  const o = {}; for (const k of HASH_FIELDS) o[k] = p[k] == null ? "" : String(p[k]);
  return crypto.createHash("sha256").update(JSON.stringify(o)).digest("hex");
}
