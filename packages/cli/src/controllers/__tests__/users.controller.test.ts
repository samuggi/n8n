import type { User, PublicUser } from '@n8n/db';
import type { UserRepository } from '@n8n/db';
import { mock, mockDeep } from 'jest-mock-extended';
import { ProjectRoleDto } from '@n8n/api-types';

import type { EventService } from '@/events/event.service';
import type { AuthenticatedRequest } from '@/requests';
import type { ProjectService } from '@/services/project.service.ee';
import type { UserService } from '@/services/user.service'; // Import UserService
import { UsersController } from '../users.controller';
import { NotFoundError } from '@/errors';

describe('UsersController', () => {
	const eventService = mock<EventService>();
	const userRepository = mock<UserRepository>();
	const projectService = mock<ProjectService>();
	const userService = mock<UserService>(); // Mock UserService

	const controller = new UsersController(
		mock(), // logger
		mock(), // externalHooks
		mock(), // sharedCredentialsRepository
		mock(), // sharedWorkflowRepository
		userRepository,
		mock(), // authService
		userService, // Use the mocked userService here
		mock(), // projectRepository
		mock(), // workflowService
		mock(), // credentialsService
		projectService,
		eventService,
		mock(), // folderService
	);

	const mockAuthedRequest = mockDeep<AuthenticatedRequest>({
		user: { id: 'actorUserId', role: 'global:admin' } as User,
	});

	beforeEach(() => {
		jest.restoreAllMocks();
		jest.clearAllMocks();
	});

	describe('changeGlobalRole', () => {
		it('should emit event user-changed-role', async () => {
			const request = mock<AuthenticatedRequest>({
				user: { id: '123' },
			});
			userRepository.findOneBy.mockResolvedValue(mock<User>({ id: '456' }));
			projectService.getUserOwnedOrAdminProjects.mockResolvedValue([]);

			await controller.changeGlobalRole(
				request,
				mock(),
				mock({ newRoleName: 'global:member' }),
				'456',
			);

			expect(eventService.emit).toHaveBeenCalledWith('user-changed-role', {
				userId: '123',
				targetUserId: '456',
				targetUserNewRole: 'global:member',
				publicApi: false,
			});
		});
	});

	describe('Project Role Management', () => {
		const targetUserId = 'targetUserId';
		const projectId = 'projectId1';
		const roleToAssign = 'editor';

		describe('assignProjectRoleController', () => {
			const assignPayload: ProjectRoleDto = { role: roleToAssign };
			const mockUpdatedUser = { id: targetUserId, projectRoles: [{ projectId, role: roleToAssign }] } as User;
			const mockPublicUser = { id: targetUserId, projectRoles: [{ projectId, role: roleToAssign }] } as PublicUser;

			it('should successfully assign a project role', async () => {
				userService.assignProjectRole.mockResolvedValue(mockUpdatedUser);
				userService.toPublic.mockResolvedValue(mockPublicUser);

				const result = await controller.assignProjectRoleController(
					mockAuthedRequest,
					targetUserId,
					projectId,
					assignPayload,
				);

				expect(userService.assignProjectRole).toHaveBeenCalledWith(targetUserId, projectId, roleToAssign);
				expect(eventService.emit).toHaveBeenCalledWith('user-project-role-assigned', {
					actorUserId: mockAuthedRequest.user.id,
					targetUserId,
					projectId,
					role: roleToAssign,
				});
				expect(userService.toPublic).toHaveBeenCalledWith(mockUpdatedUser, { withProjectRoles: true });
				expect(result).toEqual(mockPublicUser);
			});

			it('should propagate error if userService.assignProjectRole fails', async () => {
				const errorMessage = 'User not found';
				userService.assignProjectRole.mockRejectedValue(new NotFoundError(errorMessage));

				await expect(
					controller.assignProjectRoleController(
						mockAuthedRequest,
						targetUserId,
						projectId,
						assignPayload,
					),
				).rejects.toThrow(NotFoundError);
				expect(userService.assignProjectRole).toHaveBeenCalledWith(targetUserId, projectId, roleToAssign);
				expect(eventService.emit).not.toHaveBeenCalled();
			});
		});

		describe('revokeProjectRoleController', () => {
			const mockUpdatedUserAfterRevoke = { id: targetUserId, projectRoles: [] } as User;
			const mockPublicUserAfterRevoke = { id: targetUserId, projectRoles: [] } as PublicUser;

			it('should successfully revoke a project role', async () => {
				userService.revokeProjectRole.mockResolvedValue(mockUpdatedUserAfterRevoke);
				userService.toPublic.mockResolvedValue(mockPublicUserAfterRevoke);

				const result = await controller.revokeProjectRoleController(
					mockAuthedRequest,
					targetUserId,
					projectId,
				);

				expect(userService.revokeProjectRole).toHaveBeenCalledWith(targetUserId, projectId);
				expect(eventService.emit).toHaveBeenCalledWith('user-project-role-revoked', {
					actorUserId: mockAuthedRequest.user.id,
					targetUserId,
					projectId,
				});
				expect(userService.toPublic).toHaveBeenCalledWith(mockUpdatedUserAfterRevoke, { withProjectRoles: true });
				expect(result).toEqual(mockPublicUserAfterRevoke);
			});

			it('should propagate error if userService.revokeProjectRole fails', async () => {
				const errorMessage = 'User not found or role not assigned';
				userService.revokeProjectRole.mockRejectedValue(new NotFoundError(errorMessage));

				await expect(
					controller.revokeProjectRoleController(
						mockAuthedRequest,
						targetUserId,
						projectId,
					),
				).rejects.toThrow(NotFoundError);
				expect(userService.revokeProjectRole).toHaveBeenCalledWith(targetUserId, projectId);
				expect(eventService.emit).not.toHaveBeenCalled();
			});
		});
	});
});
