import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import Navigation from "@/components/navigation";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ManagedUser = {
  id: string;
  username: string;
  email: string;
  role: string;
  account_status: string;
  mfa_enabled: boolean;
};

type UserActivity = {
  id: string;
  client_id: string | null;
  client_name: string;
  event_type: string;
  success: boolean;
  created_at: string;
  actor: string;
};

const activityLabels: Record<string, string> = {
  login: "Signed in",
  password_verified: "Password verified",
  mfa_challenge: "MFA verified",
  mfa_enrollment: "MFA enrolled",
  mfa_recovery_used: "Recovery code used",
  mfa_step_up: "Identity re-verified",
  password_changed: "Password changed",
  password_reset_requested: "Password reset requested",
  password_reset_completed: "Password reset completed",
  admin_password_reset_requested: "Admin sent a password reset",
  user_created: "User account created",
  user_updated: "User account updated",
  admin_mfa_reset: "Admin reset MFA",
  session_revoked: "Session ended",
  csrf_rejected: "Unverified request blocked",
  admin_access_denied: "Admin access denied",
};

function activityLabel(eventType: string): string {
  return activityLabels[eventType] || eventType.replaceAll("_", " ");
}

async function request(url: string, method = "GET", body?: unknown) {
  const response = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

export default function UserManagement() {
  const { isAuthenticated, isAdmin, isLoading, user } = useAuth();
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState({ username: "", email: "", role: "operator", accountStatus: "active" });
  const [message, setMessage] = useState("");
  const usersQuery = useQuery<{ users: ManagedUser[] }>({
    queryKey: ["/api/admin/users"],
    enabled: isAuthenticated && isAdmin,
  });
  const activityQuery = useQuery<{
    scope: "all_tenants" | "current_tenant";
    tenants: { id: string; name: string }[];
    events: UserActivity[];
  }>({
    queryKey: ["/api/admin/user-activity"],
    enabled: isAuthenticated && isAdmin,
  });
  const refresh = async () => {
    await Promise.all([usersQuery.refetch(), activityQuery.refetch()]);
  };
  const save = useMutation({
    mutationFn: () => editing
      ? request(`/api/admin/users/${editing.id}`, "PATCH", form)
      : request("/api/admin/users", "POST", form),
    onSuccess: async () => {
      setEditing(null);
      setForm({ username: "", email: "", role: "operator", accountStatus: "active" });
      setMessage("User saved.");
      await refresh();
    },
    onError: (error: Error) => setMessage(error.message),
  });
  const sendReset = useMutation({
    mutationFn: (id: string) => request(`/api/admin/users/${id}/send-reset`, "POST", {}),
    onSuccess: () => setMessage("A reset link was sent if delivery succeeded."),
    onError: (error: Error) => setMessage(error.message),
  });
  const resetMfa = useMutation({
    mutationFn: (id: string) => request(`/api/admin/users/${id}/reset-mfa`, "POST", {}),
    onSuccess: async () => { setMessage("MFA was reset."); await refresh(); },
    onError: (error: Error) => setMessage(error.message),
  });

  useEffect(() => {
    if (editing) setForm({
      username: editing.username,
      email: editing.email || "",
      role: editing.role,
      accountStatus: editing.account_status,
    });
  }, [editing]);

  if (isLoading) return <div className="p-8">Loading…</div>;
  if (!isAuthenticated || !isAdmin) {
    return <div className="min-h-screen bg-gray-50"><Navigation /><main className="mx-auto max-w-2xl p-8"><h1 className="text-2xl font-semibold">Administrator access required</h1><Link href="/overview" className="text-blue-700 underline">Return to overview</Link></main></div>;
  }

  const activityByTenant = (activityQuery.data?.tenants || []).reduce<Record<string, {
    clientId: string;
    clientName: string;
    events: UserActivity[];
  }>>((groups, tenant) => {
    groups[tenant.id] = { clientId: tenant.id, clientName: tenant.name, events: [] };
    return groups;
  }, {});
  for (const event of activityQuery.data?.events || []) {
    const key = event.client_id || "unknown";
    if (!activityByTenant[key]) {
      activityByTenant[key] = {
        clientId: key,
        clientName: event.client_name || key,
        events: [],
      };
    }
    activityByTenant[key].events.push(event);
  }
  const tenantActivity = Object.values(activityByTenant);

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
        <div>
          <h1 className="text-3xl font-semibold text-[var(--trilogy-dark-blue)]">User Management</h1>
          <p className="mt-1 text-sm text-gray-600">Manage local users in your current tenant. New users receive a one-time setup link.</p>
        </div>
        {message && <p role="status" className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">{message}</p>}
        <Card>
          <CardHeader><CardTitle>{editing ? "Edit user" : "Create user"}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); setMessage(""); save.mutate(); }}>
              <div><Label htmlFor="managed-username">Username</Label><Input id="managed-username" data-testid="input-user-username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required /></div>
              <div><Label htmlFor="managed-email">Email</Label><Input id="managed-email" data-testid="input-user-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
              <div><Label htmlFor="managed-role">Role</Label><select id="managed-role" data-testid="select-user-role" className="h-10 w-full rounded-md border px-3" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="operator">Operator</option><option value="admin">Admin</option>{(user?.role === "security_admin" || form.role === "security_admin") && <option value="security_admin">Security admin</option>}</select></div>
              <div><Label htmlFor="managed-status">Status</Label><select id="managed-status" data-testid="select-user-status" className="h-10 w-full rounded-md border px-3" value={form.accountStatus} onChange={(e) => setForm({ ...form, accountStatus: e.target.value })}><option value="active">Active</option><option value="disabled">Disabled</option></select></div>
              <div className="flex gap-2 sm:col-span-2"><Button type="submit" data-testid="button-save-user" disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save changes" : "Create user"}</Button>{editing && <Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancel</Button>}</div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Tenant users</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-left text-sm"><thead className="border-b bg-gray-50"><tr><th className="p-3">Username</th><th className="p-3">Email</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Actions</th></tr></thead>
              <tbody>{(usersQuery.data?.users || []).map((user) => <tr key={user.id} className="border-b last:border-0"><td className="p-3 font-medium">{user.username}</td><td className="p-3">{user.email}</td><td className="p-3">{user.role}</td><td className="p-3">{user.account_status}</td><td className="flex flex-wrap gap-2 p-3"><Button size="sm" variant="outline" data-testid={`button-edit-user-${user.id}`} onClick={() => setEditing(user)}>Edit</Button><Button size="sm" variant="outline" data-testid={`button-send-reset-${user.id}`} onClick={() => sendReset.mutate(user.id)}>Send reset</Button><Button size="sm" variant="outline" data-testid={`button-reset-mfa-${user.id}`} onClick={() => { if (window.confirm("Reset this user's MFA? They will enroll again at next login.")) resetMfa.mutate(user.id); }}>Reset MFA</Button></td></tr>)}</tbody>
            </table>
          </CardContent>
        </Card>
        <section className="space-y-4" aria-labelledby="account-activity-heading">
          <div>
            <h2 id="account-activity-heading" className="text-2xl font-semibold text-[var(--trilogy-dark-blue)]">Account activity</h2>
            <p className="mt-1 text-sm text-gray-600">
              {activityQuery.data?.scope === "all_tenants"
                ? "Recent sign-in and account-security activity for Trilogy and each tenant."
                : `Recent sign-in and account-security activity for ${user?.clientName || "your organization"}.`}
            </p>
          </div>
          {activityQuery.isLoading && <Card><CardContent className="p-6 text-sm text-gray-500">Loading activity…</CardContent></Card>}
          {activityQuery.isError && <Card><CardContent className="p-6 text-sm text-red-700">Activity could not be loaded.</CardContent></Card>}
          {!activityQuery.isLoading && !activityQuery.isError && tenantActivity.length === 0 && (
            <Card><CardContent className="p-6 text-sm text-gray-500">No account activity has been recorded yet.</CardContent></Card>
          )}
          {tenantActivity.map((tenant) => (
            <Card key={tenant.clientId} data-testid={`activity-tenant-${tenant.clientId}`}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-3 text-lg">
                  <span>{tenant.clientName}</span>
                  <span className="text-xs font-normal text-gray-500">{tenant.events.length} recent event{tenant.events.length === 1 ? "" : "s"}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-left text-sm">
                  <thead className="border-y bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr><th className="p-3">When</th><th className="p-3">User</th><th className="p-3">Activity</th><th className="p-3">Result</th></tr>
                  </thead>
                  <tbody>
                    {tenant.events.length === 0 && (
                      <tr><td colSpan={4} className="p-4 text-center text-gray-500">No account activity recorded.</td></tr>
                    )}
                    {tenant.events.map((event) => (
                      <tr key={event.id} className="border-b last:border-0">
                        <td className="whitespace-nowrap p-3 text-gray-600">{new Date(event.created_at).toLocaleString()}</td>
                        <td className="p-3 font-medium text-gray-800">{event.actor}</td>
                        <td className="p-3 capitalize text-gray-700">{activityLabel(event.event_type)}</td>
                        <td className="p-3">
                          <span className={event.success
                            ? "rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
                            : "rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700"}>
                            {event.success ? "Completed" : "Blocked"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))}
        </section>
      </main>
    </div>
  );
}