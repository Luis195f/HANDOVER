export type Role = "nurse" | "head_nurse" | "viewer";

export function can(role: Role, action: string) {
  if (role === "head_nurse") return true;
  return action !== "admin:manage";
}
