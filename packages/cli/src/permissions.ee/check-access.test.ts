import type { User } from '@n8n/db';
import { ProjectRepository, SharedCredentialsRepository, SharedWorkflowRepository } from '@n8n/db';
import { Container } from '@n8n/di';
import { hasGlobalScope, rolesWithScope, type Scope } from '@n8n/permissions';
import { UnexpectedError } from 'n8n-workflow';

import { userHasScopes } from './check-access'; // Adjust path as necessary

// Mocking @n8n/permissions
jest.mock('@n8n/permissions', () => ({
	...jest.requireActual('@n8n/permissions'), // Import and retain default behavior
	hasGlobalScope: jest.fn(),
	rolesWithScope: jest.fn(),
}));

// Mocking @n8n/db repositories
jest.mock('@n8n/db', () => ({
	...jest.requireActual('@n8n/db'),
	ProjectRepository: jest.fn(),
	SharedWorkflowRepository: jest.fn(),
	SharedCredentialsRepository: jest.fn(),
}));

// Mocking @n8n/di Container
jest.mock('@n8n/di', () => ({
	Container: {
		get: jest.fn(),
	},
}));

describe('userHasScopes', () => {
	let mockUser: User;
	let mockProjectRepository: jest.Mocked<ProjectRepository>;
	let mockSharedWorkflowRepository: jest.Mocked<SharedWorkflowRepository>;
	let mockSharedCredentialsRepository: jest.Mocked<SharedCredentialsRepository>;

	const projectId1 = 'project-id-1';
	const projectId2 = 'project-id-2';
	const workflowId1 = 'workflow-id-1';
	const credentialId1 = 'credential-id-1';

	const scopeProjectRead: Scope[] = ['project:read'];
	const scopeWorkflowCreate: Scope[] = ['workflow:create'];

	beforeEach(() => {
		jest.clearAllMocks();

		mockUser = {
			id: 'user-id-1',
			email: 'test@example.com',
			firstName: 'Test',
			lastName: 'User',
			role: 'global:viewer', // Default global role
			projectRoles: [],
		} as User;

		// Setup mock implementations for Container.get
		mockProjectRepository = new ProjectRepository(null as any, null as any) as jest.Mocked<ProjectRepository>;
		mockSharedWorkflowRepository = new SharedWorkflowRepository(null as any) as jest.Mocked<SharedWorkflowRepository>;
		mockSharedCredentialsRepository = new SharedCredentialsRepository(null as any) as jest.Mocked<SharedCredentialsRepository>;

		(Container.get as jest.Mock).mockImplementation((token: any) => {
			if (token === ProjectRepository) return mockProjectRepository;
			if (token === SharedWorkflowRepository) return mockSharedWorkflowRepository;
			if (token === SharedCredentialsRepository) return mockSharedCredentialsRepository;
			throw new Error(`Unknown token ${String(token)}`);
		});

		// Default behavior for permission functions
		(hasGlobalScope as jest.Mock).mockReturnValue(false);
		(rolesWithScope as jest.Mock).mockReturnValue([]);
	});

	describe('Global Scope Checks', () => {
		it('should return true if user has global scope', async () => {
			(hasGlobalScope as jest.Mock).mockReturnValue(true);
			const result = await userHasScopes(mockUser, scopeProjectRead, false, { projectId: projectId1 });
			expect(result).toBe(true);
			expect(hasGlobalScope).toHaveBeenCalledWith(mockUser, scopeProjectRead, { mode: 'allOf' });
		});

		it('should return false if globalOnly is true and user does not have global scope', async () => {
			(hasGlobalScope as jest.Mock).mockReturnValue(false);
			const result = await userHasScopes(mockUser, scopeProjectRead, true, { projectId: projectId1 });
			expect(result).toBe(false);
		});
	});

	describe('Project Scope Checks (User.projectRoles)', () => {
		it('should return true if user has required role in projectRoles for projectId', async () => {
			mockUser.projectRoles = [{ projectId: projectId1, role: 'project:admin' }];
			(rolesWithScope as jest.Mock).mockReturnValue(['project:admin']); // Role 'project:admin' grants 'project:read'

			const result = await userHasScopes(mockUser, scopeProjectRead, false, { projectId: projectId1 });
			expect(result).toBe(true);
			expect(rolesWithScope).toHaveBeenCalledWith('project', scopeProjectRead);
		});

		it('should return false if user does not have required role in projectRoles for projectId', async () => {
			mockUser.projectRoles = [{ projectId: projectId1, role: 'project:viewer' }];
			(rolesWithScope as jest.Mock).mockReturnValue(['project:admin']); // 'project:read' needs 'project:admin'

			const result = await userHasScopes(mockUser, scopeProjectRead, false, { projectId: projectId1 });
			expect(result).toBe(false);
		});

		it('should return false if user has role but for a different project', async () => {
			mockUser.projectRoles = [{ projectId: projectId2, role: 'project:admin' }];
			(rolesWithScope as jest.Mock).mockReturnValue(['project:admin']);

			const result = await userHasScopes(mockUser, scopeProjectRead, false, { projectId: projectId1 });
			expect(result).toBe(false);
		});

		it('should return false if user.projectRoles is null or empty', async () => {
			mockUser.projectRoles = null;
			const result1 = await userHasScopes(mockUser, scopeProjectRead, false, { projectId: projectId1 });
			expect(result1).toBe(false);

			mockUser.projectRoles = [];
			const result2 = await userHasScopes(mockUser, scopeProjectRead, false, { projectId: projectId1 });
			expect(result2).toBe(false);
		});

		describe('projectId derivation', () => {
			it('should return true if role found via workflowId', async () => {
				mockUser.projectRoles = [{ projectId: projectId1, role: 'workflow:creator' }];
				(rolesWithScope as jest.Mock).mockReturnValue(['workflow:creator']);
				(mockSharedWorkflowRepository.findOneBy as jest.Mock).mockResolvedValue({ workflowId: workflowId1, projectId: projectId1 });

				const result = await userHasScopes(mockUser, scopeWorkflowCreate, false, { workflowId: workflowId1 });
				expect(result).toBe(true);
				expect(mockSharedWorkflowRepository.findOneBy).toHaveBeenCalledWith({ workflowId: workflowId1 });
			});

			it('should return false if workflow not found for workflowId', async () => {
				mockUser.projectRoles = [{ projectId: projectId1, role: 'workflow:creator' }];
				(rolesWithScope as jest.Mock).mockReturnValue(['workflow:creator']);
				(mockSharedWorkflowRepository.findOneBy as jest.Mock).mockResolvedValue(null);

				const result = await userHasScopes(mockUser, scopeWorkflowCreate, false, { workflowId: workflowId1 });
				expect(result).toBe(false);
			});

			it('should return true if role found via credentialId', async () => {
				mockUser.projectRoles = [{ projectId: projectId1, role: 'credential:owner' }];
				(rolesWithScope as jest.Mock).mockReturnValue(['credential:owner']);
				(mockSharedCredentialsRepository.findOneBy as jest.Mock).mockResolvedValue({ credentialsId: credentialId1, projectId: projectId1 });

				const result = await userHasScopes(mockUser, ['credential:delete'] as Scope[], false, { credentialId: credentialId1 });
				expect(result).toBe(true);
				expect(mockSharedCredentialsRepository.findOneBy).toHaveBeenCalledWith({ credentialsId: credentialId1 });
			});

			it('should return false if credential not found for credentialId', async () => {
				mockUser.projectRoles = [{ projectId: projectId1, role: 'credential:owner' }];
				(rolesWithScope as jest.Mock).mockReturnValue(['credential:owner']);
				(mockSharedCredentialsRepository.findOneBy as jest.Mock).mockResolvedValue(null);

				const result = await userHasScopes(mockUser, ['credential:delete'] as Scope[], false, { credentialId: credentialId1 });
				expect(result).toBe(false);
			});
		});
	});

	describe('Error Conditions', () => {
		it('should throw UnexpectedError if no resource ID is provided and not globalOnly', async () => {
			await expect(userHasScopes(mockUser, scopeProjectRead, false, {})).rejects.toThrow(UnexpectedError);
			await expect(userHasScopes(mockUser, scopeProjectRead, false, {})).rejects.toThrow(
				"`@ProjectScope` decorator was used but does not have a `credentialId`, `workflowId`, or `projectId` in its URL parameters, or the user does not have the required role in the project.",
			);
		});

		it('should return false if a resource ID is provided but User.projectRoles does not grant permission (e.g. role mismatch)', async () => {
			mockUser.projectRoles = [{ projectId: projectId1, role: 'project:viewer' }];
			(rolesWithScope as jest.Mock).mockReturnValue(['project:admin']); // 'project:read' needs 'project:admin'

			const result = await userHasScopes(mockUser, scopeProjectRead, false, { projectId: projectId1 });
			expect(result).toBe(false);
		});

		it('should return false if workflowId is provided but User.projectRoles does not grant permission', async () => {
			mockUser.projectRoles = [{ projectId: projectId1, role: 'viewer' }]; // Role doesn't grant workflow:create
			(rolesWithScope as jest.Mock).mockReturnValue(['workflow:creator']);
			(mockSharedWorkflowRepository.findOneBy as jest.Mock).mockResolvedValue({ workflowId: workflowId1, projectId: projectId1 });

			const result = await userHasScopes(mockUser, scopeWorkflowCreate, false, { workflowId: workflowId1 });
			expect(result).toBe(false);
		});
	});

	// Note: The original ProjectRelation logic is commented out in userHasScopes.
	// If it were active, tests for that path would be needed here.
	// For now, tests focus on the User.projectRoles path.
});
