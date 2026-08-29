// Intended real path: server/src/modules/notifications/service.ts
import type { Container } from '../../platform/container.js';
import { NotificationsRepository } from './repository.js';

export class NotificationsService {
  private repo: NotificationsRepository;

  constructor(private container: Container) {
    this.repo = new NotificationsRepository(container.db);
  }

  async list(workspaceId: string, userId: string) {
    return this.repo.list(workspaceId, userId);
  }

  async markRead(id: string) {
    return this.repo.markRead(id);
  }
}
