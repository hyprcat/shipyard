import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  Table,
} from "@shipyard/ui";
import { useNavigate, useParams } from "react-router-dom";
import {
  type TeamInvitationResponse,
  type TeamMember,
  type TeamMemberResponse,
  type TeamMembersResponse,
  type TeamRole,
  formatDateStamp,
  getMemberAccessState,
  getTeamMembersQueryKey,
  isApiError,
  requestJson,
  teamRoleBadgeTones,
  teamRoleLabels,
  teamRoleOptions,
} from "./api";

export const TeamMembersPage = () => {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const resolvedTeamId = teamId ?? "";
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("operator");
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [roleDialog, setRoleDialog] = useState<{
    readonly member: TeamMember;
    readonly role: TeamRole;
  } | null>(null);
  const [memberPendingRemoval, setMemberPendingRemoval] =
    useState<TeamMember | null>(null);

  const rosterQuery = useQuery({
    enabled: resolvedTeamId.length > 0,
    queryFn: () =>
      requestJson<TeamMembersResponse>(
        `/api/teams/${encodeURIComponent(resolvedTeamId)}/members`,
      ),
    queryKey: getTeamMembersQueryKey(resolvedTeamId),
  });

  const updateRoster = (
    updater: (current: TeamMembersResponse) => TeamMembersResponse,
  ) => {
    queryClient.setQueryData<TeamMembersResponse | undefined>(
      getTeamMembersQueryKey(resolvedTeamId),
      (current) => (current ? updater(current) : current),
    );
  };

  const inviteMemberMutation = useMutation({
    mutationFn: (input: { readonly email: string; readonly role: TeamRole }) =>
      requestJson<TeamInvitationResponse>(
        `/api/teams/${encodeURIComponent(resolvedTeamId)}/members/invitations`,
        {
          body: JSON.stringify(input),
          method: "POST",
        },
      ),
    onSuccess: ({ invitation }) => {
      updateRoster((current) => ({
        ...current,
        invitations: [...current.invitations, invitation].sort((left, right) =>
          left.email.localeCompare(right.email),
        ),
      }));
      setInviteEmail("");
      setInviteRole("operator");
      setIsInviteDialogOpen(false);
    },
  });

  const updateMemberRoleMutation = useMutation({
    mutationFn: (input: {
      readonly membershipId: string;
      readonly role: TeamRole;
    }) =>
      requestJson<TeamMemberResponse>(
        `/api/teams/${encodeURIComponent(resolvedTeamId)}/members/${input.membershipId}`,
        {
          body: JSON.stringify({ role: input.role }),
          method: "PATCH",
        },
      ),
    onSuccess: ({ member }) => {
      updateRoster((current) => ({
        ...current,
        members: current.members.map((currentMember) =>
          currentMember.id === member.id ? member : currentMember,
        ),
      }));
      setRoleDialog(null);
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (membershipId: string) =>
      requestJson<{ readonly ok: true }>(
        `/api/teams/${encodeURIComponent(resolvedTeamId)}/members/${membershipId}`,
        {
          method: "DELETE",
        },
      ),
    onSuccess: (_, membershipId) => {
      updateRoster((current) => ({
        ...current,
        members: current.members.filter((member) => member.id !== membershipId),
      }));
      setMemberPendingRemoval(null);
    },
  });

  if (rosterQuery.isPending) {
    return <div className="loading-state">Loading team roster...</div>;
  }

  if (rosterQuery.error || !rosterQuery.data) {
    const message = isApiError(rosterQuery.error)
      ? rosterQuery.error.message
      : "Unable to load this team right now.";

    return (
      <div className="app-shell">
        <div className="auth-layout">
          <Card className="panel auth-card">
            <EmptyState
              action={
                <Button onClick={() => navigate("/projects")} tone="secondary">
                  Back to projects
                </Button>
              }
              description={message}
              title="Team roster unavailable"
            />
          </Card>
        </div>
      </div>
    );
  }

  const roster = rosterQuery.data;
  const canManageMembers = roster.currentUserRole === "owner";
  const memberColumns = canManageMembers
    ? ["Member", "Role", "Access", "Invited", "Actions"]
    : ["Member", "Role", "Access", "Invited"];

  const memberRows = roster.members.map((member) => {
    const cells = [
      <div className="table-identity" key={`${member.id}-identity`}>
        <strong>{member.email}</strong>
        <span>{member.userId}</span>
      </div>,
      <Badge key={`${member.id}-role`} tone={teamRoleBadgeTones[member.role]}>
        {teamRoleLabels[member.role]}
      </Badge>,
      <Badge
        key={`${member.id}-status`}
        tone={member.acceptedAt ? "success" : "warning"}
      >
        {getMemberAccessState(member)}
      </Badge>,
      <span key={`${member.id}-invited`}>
        {formatDateStamp(member.invitedAt)}
      </span>,
    ];

    if (!canManageMembers) {
      return cells;
    }

    cells.push(
      member.role === "owner" ? (
        <span className="table-note" key={`${member.id}-actions`}>
          Owner access is fixed here.
        </span>
      ) : (
        <div className="row-actions" key={`${member.id}-actions`}>
          <Button
            aria-label={`Change role for ${member.email}`}
            onClick={() => {
              updateMemberRoleMutation.reset();
              setRoleDialog({ member, role: member.role });
            }}
            tone="secondary"
          >
            Change role
          </Button>
          <Button
            aria-label={`Remove ${member.email}`}
            onClick={() => {
              removeMemberMutation.reset();
              setMemberPendingRemoval(member);
            }}
            tone="secondary"
          >
            Remove
          </Button>
        </div>
      ),
    );

    return cells;
  });

  const invitationRows = roster.invitations.map((invitation) => [
    <strong key={`${invitation.id}-email`}>{invitation.email}</strong>,
    <Badge
      key={`${invitation.id}-role`}
      tone={teamRoleBadgeTones[invitation.role]}
    >
      {teamRoleLabels[invitation.role]}
    </Badge>,
    <Badge
      key={`${invitation.id}-status`}
      tone={invitation.status === "pending" ? "warning" : "danger"}
    >
      {invitation.status === "pending" ? "Pending" : "Expired"}
    </Badge>,
    <span key={`${invitation.id}-expires`}>
      {formatDateStamp(invitation.expiresAt)}
    </span>,
  ]);

  return (
    <div className="app-shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">Team access</p>
          <h1 className="shell-title">Manage team members</h1>
          <p className="shell-copy">
            Review active members, pending invitations, and role changes for{" "}
            <span className="inline-code">{resolvedTeamId}</span>.
          </p>
        </div>
        <div className="shell-stat">
          <span>Your role</span>
          <strong>{teamRoleLabels[roster.currentUserRole]}</strong>
          <p className="shell-copy team-stat-copy">
            {canManageMembers
              ? "Owners can invite, update roles, and remove access."
              : "Read-only access keeps roster details visible without any management controls."}
          </p>
        </div>
      </header>

      <div className="shell-grid">
        <aside className="panel nav-panel" aria-label="Team controls">
          <Card className="supplementary-panel team-summary-card">
            <div className="supplementary-heading">
              <h3>Roster summary</h3>
              <p>
                Track access by role without leaving the protected app shell.
              </p>
            </div>
            <div className="team-stat-grid">
              <div className="team-stat">
                <span>Members</span>
                <strong>{roster.members.length}</strong>
              </div>
              <div className="team-stat">
                <span>Invites</span>
                <strong>{roster.invitations.length}</strong>
              </div>
            </div>
            <Button onClick={() => navigate("/projects")} tone="secondary">
              Back to projects
            </Button>
            {canManageMembers ? (
              <Button
                onClick={() => {
                  inviteMemberMutation.reset();
                  setIsInviteDialogOpen(true);
                }}
              >
                Invite member
              </Button>
            ) : (
              <p className="table-note">Read-only access</p>
            )}
          </Card>
        </aside>

        <main className="panel detail-panel">
          <Card className="supplementary-panel">
            <div className="supplementary-heading table-heading">
              <div>
                <h3>Members</h3>
                <p>
                  Role edits update the table immediately after the API
                  succeeds.
                </p>
              </div>
              <Badge tone="info">{roster.members.length} active rows</Badge>
            </div>
            <Table
              caption="Team members"
              columns={memberColumns}
              emptyState="No members found."
              rows={memberRows}
            />
          </Card>

          <Card className="supplementary-panel">
            <div className="supplementary-heading table-heading">
              <div>
                <h3>Pending invitations</h3>
                <p>
                  Invitations stay visible with their target role and expiry.
                </p>
              </div>
              <Badge tone="warning">
                {roster.invitations.length} pending rows
              </Badge>
            </div>
            <Table
              caption="Team invitations"
              columns={["Email", "Role", "Status", "Expires"]}
              emptyState="No invitations pending."
              rows={invitationRows}
            />
          </Card>
        </main>
      </div>

      {canManageMembers ? (
        <>
          <Dialog
            actions={
              <>
                <Button
                  onClick={() => setIsInviteDialogOpen(false)}
                  tone="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={inviteMemberMutation.isPending}
                  form="invite-member-form"
                  type="submit"
                >
                  {inviteMemberMutation.isPending
                    ? "Sending..."
                    : "Send invite"}
                </Button>
              </>
            }
            description="Invite a teammate with the exact role they should land with."
            onClose={() => setIsInviteDialogOpen(false)}
            open={isInviteDialogOpen}
            title="Invite a team member"
          >
            <form
              className="auth-form"
              id="invite-member-form"
              onSubmit={(event) => {
                event.preventDefault();
                inviteMemberMutation.mutate({
                  email: inviteEmail,
                  role: inviteRole,
                });
              }}
            >
              <label className="field-label">
                Work email
                <Input
                  autoComplete="email"
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="operator@shipyard.local"
                  required
                  type="email"
                  value={inviteEmail}
                />
              </label>
              <label className="field-label">
                Role
                <select
                  className="role-select"
                  onChange={(event) =>
                    setInviteRole(event.target.value as TeamRole)
                  }
                  value={inviteRole}
                >
                  {teamRoleOptions.map((role) => (
                    <option key={role} value={role}>
                      {teamRoleLabels[role]}
                    </option>
                  ))}
                </select>
              </label>
              {inviteMemberMutation.error ? (
                <p className="inline-notice inline-notice--danger" role="alert">
                  {inviteMemberMutation.error.message}
                </p>
              ) : null}
            </form>
          </Dialog>

          <Dialog
            actions={
              <>
                <Button onClick={() => setRoleDialog(null)} tone="secondary">
                  Cancel
                </Button>
                <Button
                  disabled={updateMemberRoleMutation.isPending}
                  form="update-member-role-form"
                  type="submit"
                >
                  {updateMemberRoleMutation.isPending
                    ? "Saving..."
                    : "Save role"}
                </Button>
              </>
            }
            description={
              roleDialog
                ? `Update ${roleDialog.member.email} without reloading the page.`
                : undefined
            }
            onClose={() => setRoleDialog(null)}
            open={roleDialog !== null}
            title="Change member role"
          >
            <form
              className="auth-form"
              id="update-member-role-form"
              onSubmit={(event) => {
                event.preventDefault();

                if (!roleDialog) {
                  return;
                }

                updateMemberRoleMutation.mutate({
                  membershipId: roleDialog.member.id,
                  role: roleDialog.role,
                });
              }}
            >
              <label className="field-label">
                Role
                <select
                  className="role-select"
                  onChange={(event) =>
                    setRoleDialog((current) =>
                      current
                        ? {
                            ...current,
                            role: event.target.value as TeamRole,
                          }
                        : current,
                    )
                  }
                  value={roleDialog?.role ?? "operator"}
                >
                  {teamRoleOptions.map((role) => (
                    <option key={role} value={role}>
                      {teamRoleLabels[role]}
                    </option>
                  ))}
                </select>
              </label>
              {updateMemberRoleMutation.error ? (
                <p className="inline-notice inline-notice--danger" role="alert">
                  {updateMemberRoleMutation.error.message}
                </p>
              ) : null}
            </form>
          </Dialog>

          <Dialog
            actions={
              <>
                <Button
                  onClick={() => setMemberPendingRemoval(null)}
                  tone="secondary"
                >
                  Cancel
                </Button>
                <Button
                  disabled={removeMemberMutation.isPending}
                  onClick={() => {
                    if (memberPendingRemoval) {
                      removeMemberMutation.mutate(memberPendingRemoval.id);
                    }
                  }}
                >
                  {removeMemberMutation.isPending
                    ? "Removing..."
                    : "Remove member"}
                </Button>
              </>
            }
            description={
              memberPendingRemoval
                ? `This will remove ${memberPendingRemoval.email} from the active roster.`
                : undefined
            }
            onClose={() => setMemberPendingRemoval(null)}
            open={memberPendingRemoval !== null}
            title="Remove member"
          >
            <p className="dialog-copy">
              The change is applied through the team membership API and the
              table updates in place after it succeeds.
            </p>
            {removeMemberMutation.error ? (
              <p className="inline-notice inline-notice--danger" role="alert">
                {removeMemberMutation.error.message}
              </p>
            ) : null}
          </Dialog>
        </>
      ) : null}
    </div>
  );
};
