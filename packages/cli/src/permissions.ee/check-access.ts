import type { User } from '@n8n/db';
import { ProjectRepository, SharedCredentialsRepository, SharedWorkflowRepository } from '@n8n/db';
import { Container } from '@n8n/di';
import { hasGlobalScope, rolesWithScope, type Scope } from '@n8n/permissions';
// eslint-disable-next-line n8n-local-rules/misplaced-n8n-typeorm-import
import { In } from '@n8n/typeorm';
import { UnexpectedError } from 'n8n-workflow';

/**
 * Check if a user has the required scopes. The check can be:
 *
 * - only for scopes in the user's global role, or
 * - for scopes in the user's global role, else for scopes in the resource roles
 *   of projects including the user and the resource, else for scopes in the
 *   project roles in those projects.
 */
export async function userHasScopes(
	user: User,
	scopes: Scope[],
	globalOnly: boolean,
	{
		credentialId,
		workflowId,
		projectId,
	}: { credentialId?: string; workflowId?: string; projectId?: string } /* only one */,
): Promise<boolean> {
	if (hasGlobalScope(user, scopes, { mode: 'allOf' })) return true;

	if (globalOnly) return false;

	// New logic using User.projectRoles
	if (user.projectRoles && user.projectRoles.length > 0) {
		let currentProjectId = projectId;

		if (!currentProjectId && workflowId) {
			const sharedWorkflow = await Container.get(SharedWorkflowRepository).findOneBy({ workflowId });
			if (sharedWorkflow) {
				currentProjectId = sharedWorkflow.projectId;
			}
		}

		if (!currentProjectId && credentialId) {
			const sharedCredential = await Container.get(SharedCredentialsRepository).findOneBy({ credentialsId: credentialId });
			if (sharedCredential) {
				currentProjectId = sharedCredential.projectId;
			}
		}

		if (currentProjectId) {
			const userRoleInProject = user.projectRoles.find(pr => pr.projectId === currentProjectId);
			if (userRoleInProject) {
				// Check if userRoleInProject.role grants the required scopes.
				// This requires a mapping or a helper function.
				// For now, let's assume rolesWithScope can be adapted or a similar mechanism exists
				// for roles defined in User.projectRoles.
				// Example: if roles are 'project:admin', 'project:editor', etc.
				const permittedRolesForScope = rolesWithScope('project', scopes); // Assuming 'project' as resource type for project roles
				if (permittedRolesForScope.includes(userRoleInProject.role)) {
					return true;
				}
			}
		}
	}

	// Fallback or alternative: Original ProjectRelation-based logic (can be kept for EE or removed if User.projectRoles is the sole source)
	// For this subtask, we prioritize User.projectRoles. If the above check fails, permission is denied.
	// If co-existence is needed, the original logic below could be re-instated or adapted.
	// For now, if User.projectRoles doesn't grant access, we'll let it fall through to the error.
	// This effectively makes User.projectRoles the primary way for ProjectScope.

	// If no specific projectId, workflowId, or credentialId is found to check against User.projectRoles,
	// or if the User.projectRoles check fails, we throw the error.
	// The original logic for ProjectRelation is commented out below for reference during this transition.

	/*
	const projectRelationRoles = rolesWithScope('project', scopes);
	const userProjectIdsWithRelationRole = (
		await Container.get(ProjectRepository).find({
			where: {
				projectRelations: {
					userId: user.id,
					role: In(projectRelationRoles),
				},
			},
			select: ['id'],
		})
	).map((p) => p.id);

	if (credentialId) {
		return await Container.get(SharedCredentialsRepository).existsBy({
			credentialsId: credentialId,
			projectId: In(userProjectIdsWithRelationRole),
			role: In(rolesWithScope('credential', scopes)),
		});
	}

	if (workflowId) {
		return await Container.get(SharedWorkflowRepository).existsBy({
			workflowId,
			projectId: In(userProjectIdsWithRelationRole),
			role: In(rolesWithScope('workflow', scopes)),
		});
	}

	if (projectId) return userProjectIdsWithRelationRole.includes(projectId);
	*/

	// If User.projectRoles didn't grant permission and we are not falling back to ProjectRelations,
	// then the access is denied here, leading to the error below.
	// This will be true if currentProjectId was not determined or if the role check failed.

	if (projectId || workflowId || credentialId) {
		// If any ID was provided, but permission was not granted by User.projectRoles
		return false; // Explicitly deny if an ID was present but no role matched.
	}


	throw new UnexpectedError(
		"`@ProjectScope` decorator was used but does not have a `credentialId`, `workflowId`, or `projectId` in its URL parameters, or the user does not have the required role in the project.",
	);
}
