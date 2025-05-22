import { MigrationInterface, QueryRunner, TableColumn } from '@n8n/typeorm';

export class AddOrganizationFields1746000000000 implements MigrationInterface {
	public async up(queryRunner: QueryRunner): Promise<void> {
		// Add organizationName to project table
		await queryRunner.addColumn(
			'project',
			new TableColumn({
				name: 'organizationName',
				type: 'varchar',
				length: '255',
				isNullable: true,
			}),
		);

		// Add projectRoles to user table
		await queryRunner.addColumn(
			'user',
			new TableColumn({
				name: 'projectRoles',
				type: 'json',
				isNullable: true,
			}),
		);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.dropColumn('user', 'projectRoles');
		await queryRunner.dropColumn('project', 'organizationName');
	}
}
