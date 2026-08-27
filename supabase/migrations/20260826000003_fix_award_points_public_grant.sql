-- 20260825000005_revoke_award_points_execute.sql revoked EXECUTE from anon and
-- authenticated directly, but missed that Postgres grants EXECUTE to PUBLIC by
-- default on function creation, and every role implicitly inherits from PUBLIC.
-- Verified live via information_schema.routine_privileges: PUBLIC still held
-- EXECUTE after that migration, meaning any role (including anon) could still
-- call award_points regardless of the explicit per-role revokes. This closes it
-- properly.
REVOKE EXECUTE ON FUNCTION public.award_points(uuid, integer) FROM PUBLIC;
