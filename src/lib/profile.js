import { supabase } from "./supabase";

export async function fetchMyProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, display_name, role, is_active, branch_id, team_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}
