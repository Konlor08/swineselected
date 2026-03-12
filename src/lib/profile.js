import { supabase } from "./supabase";

export async function fetchMyProfile(userId) {
  if (!userId) return null;

  const { data, error, status } = await supabase
    .from("profiles")
    .select("user_id, display_name, role, is_active, branch_id, team_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("fetchMyProfile error:", {
      status,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    throw error;
  }

  return data ?? null;
}