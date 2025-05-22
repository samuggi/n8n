import type { User, PublicUser, Project } from '@n8n/db';
import { ProjectRepository } from '@n8n/db';
import { mock, mockDeep } from 'jest-mock-extended';
import { CreateProjectDto, UpdateProjectDto, AddProjectMemberDto } from '@n8n/api-types';

import type { EventService } from '@/events/event.service';
import type { AuthenticatedRequest } from '@/requests';
import type { ProjectService } from '@/services/project.service.ee';
import type { UserService } from '@/services/user.service';
import { ProjectController } from '../project.controller'; // Adjust path as necessary
import { TeamProjectOverQuotaError } from '@/services/project.service.ee';
import { BadRequestError } from '@/errors';

describe('ProjectController', () => {
	const projectsService = mock<ProjectService>();
	const projectRepository = mock<ProjectRepository>();
	const eventService = mock<EventService>();
	const userService = mock<UserService>();

	const controller = new ProjectController(
		projectsService,
		projectRepository,
		eventService,
		userService,
	);

	const mockAuthedRequest = mockDeep<AuthenticatedRequest>({
		user: { id: 'actorUserId', role: 'global:admin' } as User,
		posthog: {} as any, // Mock posthog if it's used in toPublic
	});

	const projectId = 'project-id-1';
	const organizationName = 'N8N Org';

	beforeEach(() => {
		jest.restoreAllMocks();
		jest.clearAllMocks();
	});

	describe('createProject', () => {
		const createPayload: CreateProjectDto & { organizationName?: string } = {
			name: 'Test Project',
			icon: 'test-icon',
			organizationName: organizationName,
		};
		const mockCreatedProject = {
			id: projectId,
			name: createPayload.name,
			icon: createPayload.icon,
			organizationName: createPayload.organizationName,
			type: 'team',
		} as Project;

		it('should create a project and pass organizationName', async () => {
			projectsService.createTeamProject.mockResolvedValue(mockCreatedProject);

			const result = await controller.createProject(mockAuthedRequest, mock(), createPayload);

			expect(projectsService.createTeamProject).toHaveBeenCalledWith(
				mockAuthedRequest.user,
				expect.objectContaining({
					name: createPayload.name,
					icon: createPayload.icon,
					organizationName: createPayload.organizationName,
				}),
			);
			expect(eventService.emit).toHaveBeenCalledWith('team-project-created', {
				userId: mockAuthedRequest.user.id,
				role: mockAuthedRequest.user.role,
			});
			expect(result).toEqual(expect.objectContaining({ ...mockCreatedProject, role: 'project:admin' }));
		});

		it('should handle TeamProjectOverQuotaError', async () => {
			projectsService.createTeamProject.mockRejectedValue(new TeamProjectOverQuotaError(1));
			await expect(
				controller.createProject(mockAuthedRequest, mock(), createPayload),
			).rejects.toThrow(BadRequestError);
		});
	});

	describe('updateProject', () => {
		const updatePayload: UpdateProjectDto & { organizationName?: string } = {
			name: 'Updated Project',
			icon: 'updated-icon',
			organizationName: 'Updated Org Name',
			relations: [], // Assuming relations are handled by syncProjectRelations
		};

		it('should update a project and pass organizationName', async () => {
			projectsService.updateProject.mockResolvedValue({} as Project); // Mock the return as needed
			projectsService.syncProjectRelations.mockResolvedValue(undefined);


			await controller.updateProject(mockAuthedRequest, mock(), updatePayload, projectId);

			expect(projectsService.updateProject).toHaveBeenCalledWith(projectId, {
				name: updatePayload.name,
				icon: updatePayload.icon,
				organizationName: updatePayload.organizationName,
			});
			// If relations are provided, syncProjectRelations should also be called
			expect(projectsService.syncProjectRelations).toHaveBeenCalledWith(projectId, updatePayload.relations);
			expect(eventService.emit).toHaveBeenCalledWith('team-project-updated', {
				userId: mockAuthedRequest.user.id,
				role: mockAuthedRequest.user.role,
				members: updatePayload.relations,
				projectId,
			});
		});
	});

	describe('Member Management', () => {
		const memberUserId = 'member-user-id';
		const memberRole = 'editor';

		describe('listProjectMembers', () => {
			const mockUserInProject = { id: memberUserId, email: 'member@test.com' } as User;
			const mockPublicUser = { id: memberUserId, email: 'member@test.com' } as PublicUser;

			it('should list project members', async () => {
				userService.getUsersInProject.mockResolvedValue([mockUserInProject]);
				userService.toPublic.mockResolvedValue(mockPublicUser);

				const result = await controller.listProjectMembers(projectId, mockAuthedRequest);

				expect(userService.getUsersInProject).toHaveBeenCalledWith(projectId);
				expect(userService.toPublic).toHaveBeenCalledWith(mockUserInProject, {
					withProjectRoles: true,
					posthog: mockAuthedRequest.posthog,
				});
				expect(result).toEqual([mockPublicUser]);
			});
		});

		describe('addProjectMember', () => {
			const addMemberPayload: AddProjectMemberDto = { userId: memberUserId, role: memberRole };
			const mockUpdatedUser = { id: memberUserId, projectRoles: [{ projectId, role: memberRole }] } as User;
			const mockPublicUser = { id: memberUserId, projectRoles: [{ projectId, role: memberRole }] } as PublicUser;

			it('should add a member to a project', async () => {
				userService.assignProjectRole.mockResolvedValue(mockUpdatedUser);
				userService.toPublic.mockResolvedValue(mockPublicUser);

				const result = await controller.addProjectMember(projectId, addMemberPayload, mockAuthedRequest);

				expect(userService.assignProjectRole).toHaveBeenCalledWith(memberUserId, projectId, memberRole);
				expect(eventService.emit).toHaveBeenCalledWith('project-member-added', {
					actorUserId: mockAuthedRequest.user.id,
					targetUserId: memberUserId,
					projectId,
					role: memberRole,
				});
				expect(userService.toPublic).toHaveBeenCalledWith(mockUpdatedUser, {
					withProjectRoles: true,
					posthog: mockAuthedRequest.posthog,
				});
				expect(result).toEqual(mockPublicUser);
			});
		});

		describe('removeProjectMember', () => {
			const mockUpdatedUser = { id: memberUserId, projectRoles: [] } as User;
			const mockPublicUser = { id: memberUserId, projectRoles: [] } as PublicUser;

			it('should remove a member from a project', async () => {
				userService.revokeProjectRole.mockResolvedValue(mockUpdatedUser);
				userService.toPublic.mockResolvedValue(mockPublicUser);

				const result = await controller.removeProjectMember(projectId, memberUserId, mockAuthedRequest);

				expect(userService.revokeProjectRole).toHaveBeenCalledWith(memberUserId, projectId);
				expect(eventService.emit).toHaveBeenCalledWith('project-member-removed', {
					actorUserId: mockAuthedRequest.user.id,
					targetUserId: memberUserId,
					projectId,
				});
				expect(userService.toPublic).toHaveBeenCalledWith(mockUpdatedUser, {
					withProjectRoles: true,
					posthog: mockAuthedRequest.posthog,
				});
				expect(result).toEqual(mockPublicUser);
			});
		});
	});
});
