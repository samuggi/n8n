import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class AddProjectMemberDto {
	@IsUUID()
	@IsNotEmpty()
	userId!: string;

	@IsString()
	@IsNotEmpty()
	role!: string;
}
