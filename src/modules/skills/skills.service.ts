import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { SaveSkillDto, UpdateSkillDto } from './skills.dto';
import { SkillSnapshot, skillCommands } from './skill-context';

@Injectable()
export class SkillsService {
  constructor(private readonly db: DataSource) {}

  list(userId: string) {
    return this.db.query(
      'SELECT id,slug,name,description,version FROM skills WHERE user_id=$1 ORDER BY name,id LIMIT 200',
      [userId],
    );
  }
  async get(userId: string, id: string) {
    const [row] = await this.db.query(
      'SELECT id,slug,name,description,instructions,version FROM skills WHERE user_id=$1 AND id=$2',
      [userId, id],
    );
    if (!row) throw new NotFoundException('Skill not found.');
    return row;
  }
  async save(userId: string, dto: SaveSkillDto | UpdateSkillDto, id?: string) {
    if (!dto.name.trim() || !dto.instructions.trim())
      throw new BadRequestException('Enter a name and instructions.');
    try {
      const rows = id
        ? await this.db.query(
            `UPDATE skills SET slug=$3,name=$4,description=$5,instructions=$6,version=version+1 WHERE user_id=$1 AND id=$2 AND version=$7 RETURNING id,slug,name,description,instructions,version`,
            [
              userId,
              id,
              dto.slug,
              dto.name.trim(),
              dto.description.trim(),
              dto.instructions.trim(),
              (dto as UpdateSkillDto).version,
            ],
          )
        : await this.db.query(
            `INSERT INTO skills(user_id,slug,name,description,instructions) SELECT $1,$2,$3,$4,$5 WHERE (SELECT count(*) FROM skills WHERE user_id=$1)<200 RETURNING id,slug,name,description,instructions,version`,
            [userId, dto.slug, dto.name.trim(), dto.description.trim(), dto.instructions.trim()],
          );
      // TypeORM returns [rows,count] for UPDATE.
      const row = id ? rows[0]?.[0] : rows[0];
      if (!row)
        throw new ConflictException('Skill changed or the library is full. Reload and try again.');
      return row;
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new ConflictException('That command name is already in your library.');
      throw error;
    }
  }
  async remove(userId: string, id: string) {
    await this.get(userId, id);
    await this.db.query('DELETE FROM skills WHERE id=$1 AND user_id=$2', [id, userId]);
  }
  private async access(
    tx: EntityManager,
    projectId: string,
    userId: string,
    conversationId: string,
  ) {
    const rows = await tx.query(
      `SELECT c.id FROM ai_conversations c JOIN project_members pm ON pm.project_id=c.project_id AND pm.user_id=c.user_id JOIN users u ON u.id=c.user_id WHERE c.id=$1 AND c.project_id=$2 AND c.user_id=$3 AND c.deleted_at IS NULL AND pm.removed_at IS NULL AND u.is_active=true FOR UPDATE OF c`,
      [conversationId, projectId, userId],
    );
    if (!rows.length) throw new NotFoundException('Conversation not found.');
  }
  async attached(projectId: string, userId: string, conversationId: string) {
    return this.db.transaction(async (tx) => {
      await this.access(tx, projectId, userId, conversationId);
      const rows = await tx.query(
        'SELECT snapshot FROM conversation_skills WHERE conversation_id=$1 ORDER BY skill_id',
        [conversationId],
      );
      return rows.map((r: { snapshot: SkillSnapshot }) => {
        const { id, slug, name, version } = r.snapshot;
        return { id, slug, name, version };
      });
    });
  }
  async detach(projectId: string, userId: string, conversationId: string, skillId: string) {
    await this.db.transaction(async (tx) => {
      const [lock] = await tx.query(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1,83)) AS locked',
        [conversationId],
      );
      if (!lock?.locked) throw new ConflictException('Wait for the current turn to finish.');
      await this.access(tx, projectId, userId, conversationId);
      await tx.query('DELETE FROM conversation_skills WHERE conversation_id=$1 AND skill_id=$2', [
        conversationId,
        skillId,
      ]);
    });
  }
  async prepare(
    projectId: string,
    userId: string,
    conversationId: string,
    prompt: string,
    manager?: EntityManager,
  ): Promise<SkillSnapshot[]> {
    const action = async (tx: EntityManager) => {
      await this.access(tx, projectId, userId, conversationId);
      const commands = skillCommands(prompt);
      for (const slug of commands) {
        const [skill] = await tx.query(
          'SELECT id,slug,name,version,instructions FROM skills WHERE user_id=$1 AND slug=$2 FOR SHARE',
          [userId, slug],
        );
        if (!skill)
          throw new BadRequestException(`Unknown skill /${slug}. Add it in Customize first.`);
        await tx.query(
          'INSERT INTO conversation_skills(conversation_id,skill_id,snapshot) VALUES($1,$2,$3::jsonb) ON CONFLICT(conversation_id,skill_id) DO UPDATE SET snapshot=excluded.snapshot',
          [conversationId, skill.id, JSON.stringify(skill)],
        );
      }
      const rows = await tx.query(
        'SELECT snapshot FROM conversation_skills WHERE conversation_id=$1 ORDER BY skill_id',
        [conversationId],
      );
      if (rows.length > 4)
        throw new BadRequestException('A chat can have up to four skills. Remove a skill first.');
      return rows.map((r: { snapshot: SkillSnapshot }) => r.snapshot);
    };
    return manager ? action(manager) : this.db.transaction(action);
  }
}
