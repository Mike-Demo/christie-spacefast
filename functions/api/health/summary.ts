/**
 * GET /api/health/summary — admin-only aggregated usage counters.
 * 7-day hourly buckets from `usage_events`, same columns as the original
 * `usage_health_summary` SQL. Counters only — no text is ever stored.
 */
import { apiError, json, withErrors } from "../../_core/http";
import { getSession } from "../../_core/auth";
import { all } from "../../_core/db";
import { initRequest, type RouteContext } from "../../_core/request";

const handle = withErrors(async (request: Request, context: RouteContext): Promise<Response> => {
  const { env } = await initRequest(request, context);
  if (request.method !== "GET") return apiError(405, "invalid_request", "Method not allowed.");

  const user = await getSession(env, request);
  if (!user) return apiError(401, "unauthorized", "Sign in to continue.");
  if (user.role !== "admin") return apiError(403, "forbidden", "Admin access required.");

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await all(
    env.db,
    `SELECT
       CONCAT(LEFT(created_at, 13), ':00:00.000Z') AS bucket_hour,
       COUNT(*) AS request_count,
       SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
       SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS error_count,
       COUNT(DISTINCT user_id) AS distinct_users,
       ROUND(AVG(latency_ms), 1) AS avg_latency_ms,
       ROUND(AVG(character_count), 1) AS avg_character_count
     FROM usage_events
     WHERE created_at >= ?
     GROUP BY bucket_hour
     ORDER BY bucket_hour DESC`,
    cutoff,
  );

  return json({
    buckets: rows.map((row) => ({
      bucket_hour: String(row["bucket_hour"]),
      request_count: Number(row["request_count"]),
      success_count: Number(row["success_count"]),
      error_count: Number(row["error_count"]),
      distinct_users: Number(row["distinct_users"]),
      avg_latency_ms: row["avg_latency_ms"] == null ? null : Number(row["avg_latency_ms"]),
      avg_character_count:
        row["avg_character_count"] == null ? null : Number(row["avg_character_count"]),
    })),
  });
});

/** SpaceFast Functions entries: one export per HTTP method. */
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const OPTIONS = handle;
