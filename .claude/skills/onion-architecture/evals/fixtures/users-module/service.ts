// Intended real path: server/src/modules/users/service.ts
import type { Container } from '../../platform/container.js';
import { UsersRepository, type UserRow } from './repository.js';

export class UsersService {
  private repo: UsersRepository;

  constructor(private container: Container) {
    this.repo = new UsersRepository(container.db);
  }

  async listUsers(workspaceId: string): Promise<UserRow[]> {
    return this.repo.list(workspaceId);
  }

  async getUser(workspaceId: string, id: string): Promise<UserRow | undefined> {
    return this.repo.getById(workspaceId, id);
  }

  async createUser(
    workspaceId: string,
    name: string,
    email: string,
    role: 'admin' | 'user',
  ): Promise<UserRow> {
    return this.repo.insert(workspaceId, { name, email, role });
  }

  async updateUser(
    workspaceId: string,
    id: string,
    patch: { name?: string; email?: string; role?: 'admin' | 'user' },
  ): Promise<UserRow | undefined> {
    return this.repo.update(workspaceId, id, patch);
  }

  async deleteUser(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.delete(workspaceId, id);
  }
}
