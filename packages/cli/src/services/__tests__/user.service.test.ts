import { GlobalConfig } from '@n8n/config';
import { User } from '@n8n/db';
import { UserRepository } from '@n8n/db';
import { mock } from 'jest-mock-extended';
import { v4 as uuid } from 'uuid';

import { UrlService } from '@/services/url.service';
import { UserService } from '@/services/user.service';
import { mockInstance } from '@test/mocking';

describe('UserService', () => {
	const globalConfig = mockInstance(GlobalConfig, {
		host: 'localhost',
		path: '/',
		port: 5678,
		listen_address: '0.0.0.0',
		protocol: 'http',
	});
	const urlService = new UrlService(globalConfig);
	const userRepository = mockInstance(UserRepository);
	const userService = new UserService(mock(), userRepository, mock(), urlService, mock(), mock());

	const commonMockUser = Object.assign(new User(), {
		id: uuid(),
		password: 'passwordHash',
	});

	const mockUser = Object.assign(new User(), {
		id: 'userId1',
		email: 'user1@test.com',
		firstName: 'Test',
		lastName: 'User1',
		password: 'passwordHash',
		projectRoles: [],
	});

	beforeEach(() => {
		jest.clearAllMocks();
		// Reset projectRoles for mockUser before each test that might modify it
		mockUser.projectRoles = [];
	});

	describe('toPublic', () => {
		it('should remove sensitive properties', async () => {
			const userWithSensitiveData = Object.assign(new User(), {
				id: uuid(),
				password: 'passwordHash',
				mfaEnabled: false,
				mfaSecret: 'test',
				mfaRecoveryCodes: ['test'],
				updatedAt: new Date(),
				authIdentities: [],
			});

			type MaybeSensitiveProperties = Partial<
				Pick<User, 'password' | 'updatedAt' | 'authIdentities'>
			>;

			// to prevent typechecking from blocking assertions
			const publicUser: MaybeSensitiveProperties = await userService.toPublic(mockUser);

			expect(publicUser.password).toBeUndefined();
			expect(publicUser.updatedAt).toBeUndefined();
			expect(publicUser.authIdentities).toBeUndefined();
		});

		it('should add scopes if requested', async () => {
			const scoped = await userService.toPublic(commonMockUser, { withScopes: true });
			const unscoped = await userService.toPublic(commonMockUser);

			expect(scoped.globalScopes).toEqual([]);
			expect(unscoped.globalScopes).toBeUndefined();
		});

		it('should add invite URL if requested', async () => {
			const firstUser = Object.assign(new User(), { id: uuid() });
			const secondUser = Object.assign(new User(), { id: uuid(), isPending: true });

			const withoutUrl = await userService.toPublic(secondUser);
			const withUrl = await userService.toPublic(secondUser, {
				withInviteUrl: true,
				inviterId: firstUser.id,
			});

			expect(withoutUrl.inviteAcceptUrl).toBeUndefined();

			const url = new URL(withUrl.inviteAcceptUrl ?? '');

			expect(url.searchParams.get('inviterId')).toBe(firstUser.id);
			expect(url.searchParams.get('inviteeId')).toBe(secondUser.id);
		});

		it('should include projectRoles if requested', async () => {
			const userWithRoles = { ...commonMockUser, projectRoles: [{ projectId: 'proj1', role: 'admin' }] };
			const publicUserWithRoles = await userService.toPublic(userWithRoles as User, {
				withProjectRoles: true,
			});
			const publicUserWithoutRoles = await userService.toPublic(userWithRoles as User, {
				withProjectRoles: false,
			});
			const publicUserDefault = await userService.toPublic(userWithRoles as User);

			expect(publicUserWithRoles.projectRoles).toEqual([{ projectId: 'proj1', role: 'admin' }]);
			expect(publicUserWithoutRoles.projectRoles).toBeUndefined();
			expect(publicUserDefault.projectRoles).toBeUndefined(); // Default is false
		});
	});

	describe('update', () => {
		// We need to use `save` so that that the subscriber in
		// packages/cli/src/databases/entities/Project.ts receives the full user.
		// With `update` it would only receive the updated fields, e.g. the `id`
		// would be missing.
		it('should use `save` instead of `update`', async () => {
			const user = new User();
			user.firstName = 'Not Nathan';
			user.lastName = 'Nathaniel';

			const userId = '1234';
			const data = {
				firstName: 'Nathan',
			};

			userRepository.findOneBy.mockResolvedValueOnce(user);

			await userService.update(userId, data);

			expect(userRepository.save).toHaveBeenCalledWith({ ...user, ...data }, { transaction: true });
			expect(userRepository.update).not.toHaveBeenCalled();
		});
	});

	describe('Project Roles Management', () => {
		const projectId1 = 'projectId1';
		const projectId2 = 'projectId2';
		const roleAdmin = 'admin';
		const roleEditor = 'editor';

		describe('assignProjectRole', () => {
			it('should assign a new role to a user for a project', async () => {
				userRepository.findOneBy.mockResolvedValueOnce(mockUser as User);
				userRepository.save.mockImplementation(async (user) => user as User);

				const updatedUser = await userService.assignProjectRole(
					mockUser.id,
					projectId1,
					roleAdmin,
				);

				expect(userRepository.findOneBy).toHaveBeenCalledWith({ id: mockUser.id });
				expect(updatedUser.projectRoles).toEqual([{ projectId: projectId1, role: roleAdmin }]);
				expect(userRepository.save).toHaveBeenCalledWith(
					expect.objectContaining({
						id: mockUser.id,
						projectRoles: [{ projectId: projectId1, role: roleAdmin }],
					}),
				);
			});

			it('should update an existing role for a user in a project', async () => {
				mockUser.projectRoles = [{ projectId: projectId1, role: roleAdmin }];
				userRepository.findOneBy.mockResolvedValueOnce(mockUser as User);
				userRepository.save.mockImplementation(async (user) => user as User);

				const updatedUser = await userService.assignProjectRole(
					mockUser.id,
					projectId1,
					roleEditor,
				);

				expect(updatedUser.projectRoles).toEqual([{ projectId: projectId1, role: roleEditor }]);
				expect(userRepository.save).toHaveBeenCalledWith(
					expect.objectContaining({
						id: mockUser.id,
						projectRoles: [{ projectId: projectId1, role: roleEditor }],
					}),
				);
			});

			it('should add a role for a new project, keeping existing ones', async () => {
				mockUser.projectRoles = [{ projectId: projectId1, role: roleAdmin }];
				userRepository.findOneBy.mockResolvedValueOnce(mockUser as User);
				userRepository.save.mockImplementation(async (user) => user as User);

				const updatedUser = await userService.assignProjectRole(
					mockUser.id,
					projectId2,
					roleEditor,
				);

				expect(updatedUser.projectRoles).toEqual([
					{ projectId: projectId1, role: roleAdmin },
					{ projectId: projectId2, role: roleEditor },
				]);
				expect(userRepository.save).toHaveBeenCalledWith(
					expect.objectContaining({
						id: mockUser.id,
						projectRoles: [
							{ projectId: projectId1, role: roleAdmin },
							{ projectId: projectId2, role: roleEditor },
						],
					}),
				);
			});

			it('should throw NotFoundError if user not found', async () => {
				userRepository.findOneBy.mockResolvedValueOnce(null);
				await expect(
					userService.assignProjectRole(mockUser.id, projectId1, roleAdmin),
				).rejects.toThrow(`User with ID "${mockUser.id}" not found`);
			});
		});

		describe('revokeProjectRole', () => {
			it('should revoke a role from a user for a project', async () => {
				mockUser.projectRoles = [
					{ projectId: projectId1, role: roleAdmin },
					{ projectId: projectId2, role: roleEditor },
				];
				userRepository.findOneBy.mockResolvedValueOnce(mockUser as User);
				userRepository.save.mockImplementation(async (user) => user as User);

				const updatedUser = await userService.revokeProjectRole(mockUser.id, projectId1);

				expect(updatedUser.projectRoles).toEqual([{ projectId: projectId2, role: roleEditor }]);
				expect(userRepository.save).toHaveBeenCalledWith(
					expect.objectContaining({
						id: mockUser.id,
						projectRoles: [{ projectId: projectId2, role: roleEditor }],
					}),
				);
			});

			it('should do nothing if user has no roles', async () => {
				mockUser.projectRoles = [];
				userRepository.findOneBy.mockResolvedValueOnce(mockUser as User);
				userRepository.save.mockImplementation(async (user) => user as User);

				const updatedUser = await userService.revokeProjectRole(mockUser.id, projectId1);
				expect(updatedUser.projectRoles).toEqual([]);
				// save might not be called if there are no changes, or it might be called with the same data
				// for this test, we assume it might be called or not, depending on implementation detail
				// if it is called, it should be with empty projectRoles
			});

			it('should do nothing if user has roles but not for the specified project', async () => {
				mockUser.projectRoles = [{ projectId: projectId2, role: roleEditor }];
				userRepository.findOneBy.mockResolvedValueOnce(mockUser as User);
				userRepository.save.mockImplementation(async (user) => user as User);

				const updatedUser = await userService.revokeProjectRole(mockUser.id, projectId1);
				expect(updatedUser.projectRoles).toEqual([{ projectId: projectId2, role: roleEditor }]);
			});

			it('should throw NotFoundError if user not found', async () => {
				userRepository.findOneBy.mockResolvedValueOnce(null);
				await expect(userService.revokeProjectRole(mockUser.id, projectId1)).rejects.toThrow(
					`User with ID "${mockUser.id}" not found`,
				);
			});
		});

		describe('getProjectRoles', () => {
			it('should retrieve roles for a user with multiple project roles', async () => {
				const roles = [
					{ projectId: projectId1, role: roleAdmin },
					{ projectId: projectId2, role: roleEditor },
				];
				mockUser.projectRoles = roles;
				userRepository.findOneBy.mockResolvedValueOnce(mockUser as User);

				const retrievedRoles = await userService.getProjectRoles(mockUser.id);
				expect(retrievedRoles).toEqual(roles);
			});

			it('should return empty array for a user with no project roles', async () => {
				mockUser.projectRoles = [];
				userRepository.findOneBy.mockResolvedValueOnce(mockUser as User);

				const retrievedRoles = await userService.getProjectRoles(mockUser.id);
				expect(retrievedRoles).toEqual([]);
			});

			it('should return empty array if projectRoles is null', async () => {
				mockUser.projectRoles = null;
				userRepository.findOneBy.mockResolvedValueOnce(mockUser as User);

				const retrievedRoles = await userService.getProjectRoles(mockUser.id);
				expect(retrievedRoles).toEqual([]);
			});

			it('should throw NotFoundError if user not found', async () => {
				userRepository.findOneBy.mockResolvedValueOnce(null);
				await expect(userService.getProjectRoles(mockUser.id)).rejects.toThrow(
					`User with ID "${mockUser.id}" not found`,
				);
			});
		});

		describe('getUsersInProject', () => {
			const user2 = Object.assign(new User(), {
				id: 'userId2',
				email: 'user2@test.com',
				projectRoles: [{ projectId: projectId1, role: roleEditor }],
			});
			const user3 = Object.assign(new User(), {
				id: 'userId3',
				email: 'user3@test.com',
				projectRoles: [{ projectId: projectId2, role: roleAdmin }], // Different project
			});
			const user4 = Object.assign(new User(), {
				id: 'userId4',
				email: 'user4@test.com',
				projectRoles: null, // No roles
			});

			beforeEach(() => {
				mockUser.projectRoles = [{ projectId: projectId1, role: roleAdmin }];
			});

			it('should get all users in a project', async () => {
				userRepository.find.mockResolvedValueOnce([
					mockUser as User,
					user2 as User,
					user3 as User,
					user4 as User,
				]);
				const users = await userService.getUsersInProject(projectId1);
				expect(users.length).toBe(2);
				expect(users.find((u) => u.id === mockUser.id)).toBeDefined();
				expect(users.find((u) => u.id === user2.id)).toBeDefined();
			});

			it('should filter users by a specific role in a project', async () => {
				userRepository.find.mockResolvedValueOnce([
					mockUser as User,
					user2 as User,
					user3 as User,
				]);
				const users = await userService.getUsersInProject(projectId1, roleAdmin);
				expect(users.length).toBe(1);
				expect(users[0].id).toBe(mockUser.id);
			});

			it('should return empty array if no users match project and role', async () => {
				userRepository.find.mockResolvedValueOnce([
					mockUser as User,
					user2 as User,
					user3 as User,
				]);
				const users = await userService.getUsersInProject(projectId1, 'nonExistentRole');
				expect(users.length).toBe(0);
			});

			it('should return empty array if no users are in the project', async () => {
				userRepository.find.mockResolvedValueOnce([user3 as User, user4 as User]);
				const users = await userService.getUsersInProject(projectId1);
				expect(users.length).toBe(0);
			});
		});
	});
});
