import { IsNotEmpty, IsString } from 'class-validator';

export class ProjectRoleDto {
	@IsString()
	@IsNotEmpty()
	role!: string;
}
